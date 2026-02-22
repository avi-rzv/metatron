# AI Tools and System Instruction

This document covers the system instruction service, the AI function-calling tools, and the SQL sandbox that gives the AI persistent memory and a private database.

---

## Overview

Every LLM call in MetatronOS can carry a dynamic system prompt assembled from three sources:

1. **Core instruction** — a static text the user writes that defines the AI's identity and behaviour
2. **Memory** — a bullet-point blob the AI maintains autonomously via the `save_memory` tool
3. **Database schema documentation** — a Markdown description of tables the AI has created, maintained via `update_db_schema`

The AI also has direct SQL access to the SQLite database through the `db_query` tool, limited to tables whose names start with `ai_`. Core application tables (`chats`, `messages`, `settings`) are blocked.

---

## System Instruction Service (`src/services/systemInstruction.ts`)

### Storage

The `SystemInstruction` object is stored as a single JSON blob in the `settings` table under the key `system_instruction`. Because the `settings` table already holds arbitrary key/value rows, no schema change is required for this feature.

### The `SystemInstruction` interface

```typescript
interface SystemInstruction {
  coreInstruction: string;  // user-authored; injected verbatim
  memory: string;           // AI-managed; max 4,000 characters
  memoryEnabled: boolean;   // when false, tools are not passed to the LLM
  dbSchema: string;         // AI-managed Markdown documentation of ai_ tables
  updatedAt: string;        // ISO 8601; updated on every write
}
```

### Defaults

The default `coreInstruction` is a multi-section prompt that:
- Establishes the AI's name as "Metatron" and suppresses underlying model identity
- Instructs the AI to act autonomously, prefer action over clarification, and confirm before irreversible operations
- Sets response format expectations (concise, code blocks with language labels, task summaries)

The default `memory` and `dbSchema` are empty strings. `memoryEnabled` defaults to `true`.

### Exported functions

| Function | Description |
|----------|-------------|
| `getSystemInstruction()` | Returns the full `SystemInstruction` object (defaults if not yet stored) |
| `updateSystemInstruction(partial)` | Shallow-merges the partial update, stamps `updatedAt`, persists |
| `updateMemory(memory)` | Validates the 4,000-character limit, then delegates to `updateSystemInstruction` |
| `updateDbSchema(schema)` | Persists the AI's schema documentation string |
| `getDbSchema()` | Returns the current schema documentation string |
| `buildCombinedPrompt()` | Assembles the final system prompt string sent to the LLM (see below) |

### `buildCombinedPrompt()`

This function assembles the text injected as `systemInstruction` into every LLM call:

```
<coreInstruction>

---

## Your Memory
<memory content, or "No memories stored yet." if empty>

## Your Database
<dbSchema content, or placeholder text if empty>
```

If `coreInstruction` is blank (whitespace only), the function returns `null` and no system instruction is sent.

---

## AI Tool Callbacks (`src/services/aiTools.ts`)

`createAIToolCallbacks()` returns an `AIToolCallbacks` object used by both LLM adapters. Each method returns a JSON string — the serialised result that is fed back to the model as the function call response.

```typescript
interface AIToolCallbacks {
  saveMemory: (memory: string) => Promise<string>;
  dbQuery: (sql: string) => Promise<string>;
  updateDbSchema: (schema: string) => Promise<string>;
}
```

### `saveMemory(memory)`

Calls `updateMemory()` from the system instruction service. Enforces the 4,000-character limit — if exceeded, the returned JSON contains an `error` field and the memory is not written.

Returns: `{ success: true, message: "Memory updated successfully" }` or `{ error: "..." }`.

### `dbQuery(sql)`

Executes a SQL statement against the raw `better-sqlite3` instance (`sqlite` from `src/db/index.ts`). Before executing, `validateAIQuery()` is called. The execution path branches on the SQL verb:

| SQL verb | Method | Return |
|----------|--------|--------|
| `SELECT`, `PRAGMA`, `EXPLAIN` | `stmt.all()` | `{ rows: [...] }` |
| `INSERT`, `UPDATE`, `DELETE` | `stmt.run()` | `{ affectedRows: N }` |
| `CREATE`, `ALTER`, `DROP`, other DDL | `sqlite.exec()` | `{ success: true }` |

Any exception from SQLite is caught and returned as `{ error: "..." }`.

### `updateDbSchema(schema)`

Calls `updateDbSchema()` from the system instruction service to store the AI's own Markdown documentation of its tables.

Returns: `{ success: true, message: "Schema updated successfully" }` or `{ error: "..." }`.

---

## SQL Sandbox (`src/services/sqlValidator.ts`)

`validateAIQuery(sql)` protects the three core application tables:

```typescript
const PROTECTED_TABLES = ['chats', 'messages', 'settings'];
```

For each protected table name, it tests a word-boundary regex (`\b<table>\b`, case-insensitive) against the full SQL string. If any protected name appears, the query is rejected before it reaches SQLite.

```typescript
validateAIQuery("SELECT * FROM chats")
// { valid: false, error: "Access denied: the 'chats' table is a protected core table..." }

validateAIQuery("SELECT * FROM ai_notes")
// { valid: true }
```

The validator does not enforce the `ai_` prefix — it only blocks protected names. The LLM is instructed via tool descriptions to use the `ai_` prefix, and the tool descriptions are the primary enforcement point for that convention.

---

## Raw SQLite Export (`src/db/index.ts`)

In addition to the existing Drizzle `db` export, `src/db/index.ts` now exports the raw `better-sqlite3` connection:

```typescript
export const sqlite: DatabaseType = new Database(DB_PATH);
export const db = drizzle(sqlite, { schema });
```

`sqlite` is used by `aiTools.ts` because it provides synchronous statement execution (`stmt.all()`, `stmt.run()`, `sqlite.exec()`) for arbitrary SQL, whereas the Drizzle query builder is scoped to the known schema tables. Outside of `aiTools.ts`, prefer `db` (Drizzle) for all queries — it provides type safety and integrates with the schema definitions.

---

## Function-Calling Integration

### When tools are active

Tools are passed to the LLM only when `systemInstruction.memoryEnabled` is `true`. The stream route in `src/routes/chats.ts` checks this flag:

```typescript
const sysInstr = await getSystemInstruction();
const toolCallbacks = sysInstr.memoryEnabled ? createAIToolCallbacks() : null;
```

`toolCallbacks` (or `null`) is passed through to both `streamGeminiChat()` and `streamOpenAIChat()`.

### Three tools exposed to the LLM

| Tool name | Trigger | Action |
|-----------|---------|--------|
| `save_memory` | AI decides to remember something | Replaces the entire memory blob; new content is injected in the next session |
| `db_query` | AI needs to store or retrieve structured data | Executes SQL against the SQLite file; blocked from core tables |
| `update_db_schema` | AI creates, alters, or drops an `ai_` table | Updates the schema documentation shown in future sessions |

### Gemini function-calling loop

The Gemini adapter (`src/services/llm/gemini.ts`) implements a multi-turn function-calling loop:

1. Send the user message to the chat stream
2. Collect text chunks (emitted via `onChunk`) and any `functionCalls` from the response
3. If `functionCalls` is non-empty, execute them all via `executeFunctionCalls()` and collect `Part[]` responses
4. Send the `Part[]` responses back to the same chat session via another `sendMessageStream()` call
5. Repeat until a turn produces no function calls

`FunctionCallingConfigMode.AUTO` is used, which lets Gemini decide whether to call a tool or respond directly.

Array results from `dbQuery` are wrapped in `{ data: [...] }` before being returned to the Gemini API, because the Gemini SDK requires function responses to be JSON objects (Struct), not arrays.

### OpenAI function-calling path

The OpenAI adapter (`src/services/llm/openai.ts`) uses `client.beta.chat.completions.runTools()` from the `openai` SDK. This helper manages the tool call loop internally — the adapter does not need to implement a manual loop. The `content` event on the runner emits delta strings which are forwarded via `onChunk`. `runner.finalChatCompletion()` is awaited before calling `onDone()`.

When `toolCallbacks` is `null`, the adapter falls back to the standard `client.chat.completions.create()` streaming path.

---

## Memory Lifecycle

```
User chats
    │
    ▼
buildCombinedPrompt() assembles prompt
(coreInstruction + memory + dbSchema)
    │
    ▼
LLM receives combined system prompt
    │
    ├─ LLM decides to remember something
    │       │
    │       ▼
    │  save_memory tool called
    │  updateMemory() writes to settings table
    │  (replaces entire memory blob; 4,000-char limit)
    │
    ├─ LLM wants to store structured data
    │       │
    │       ▼
    │  db_query tool called
    │  SQL executed against sqlite
    │  (protected tables blocked; ai_ prefix by convention)
    │
    └─ LLM creates/alters an ai_ table
            │
            ▼
       update_db_schema tool called
       Schema doc written to settings table
       (appears in future sessions under ## Your Database)
```

---

## Constraints and Limits

- Memory blob is capped at **4,000 characters**. Exceeding this causes `updateMemory()` to throw, and the tool response carries an error the LLM sees.
- The `dbSchema` field has no enforced size limit. It is the AI's own documentation and is expected to be concise Markdown.
- Protected table names (`chats`, `messages`, `settings`) are blocked at the string level — the AI cannot read or modify application data. The AI's tables live in the same SQLite file but are namespaced by the `ai_` convention.
- The `memoryEnabled` toggle disables **all three tools** simultaneously — there is no per-tool enable/disable.

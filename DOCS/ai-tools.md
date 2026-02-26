# AI Tools and System Instruction

This document covers the system instruction service, the AI function-calling tools, and the MongoDB sandbox that gives the AI persistent memory and a private database.

---

## Overview

Every LLM call in MetatronOS can carry a dynamic system prompt assembled from three sources:

1. **Core instruction** — a static text the user writes that defines the AI's identity and behaviour
2. **Memory** — a bullet-point blob the AI maintains autonomously via the `save_memory` tool
3. **Database schema documentation** — a Markdown description of collections the AI has created, maintained via `update_db_schema`

The AI also has direct MongoDB access through the `db_query` tool. Built-in AI-managed collections (`master`, `contacts`, `schedule`, `cronjobs`) and any `ai_`-prefixed collection support full read/write. Core application collections (`chats`, `messages`, `settings`, `media`, `attachments`) are read-only for AI write operations.

---

## System Instruction Service (`src/services/systemInstruction.ts`)

### Storage

The `SystemInstruction` object is stored as a single JSON blob in the `settings` collection under the key `system_instruction` (the `_id` field). Because the `settings` collection already holds arbitrary key/value documents, no schema change is required for this feature.

### The `SystemInstruction` interface

```typescript
interface SystemInstruction {
  coreInstruction: string;  // user-authored; injected verbatim
  memory: string;           // AI-managed; max 4,000 characters
  memoryEnabled: boolean;   // when false, tools are not passed to the LLM
  dbSchema: string;         // AI-managed Markdown documentation of ai_ collections
  updatedAt: string;        // ISO 8601; updated on every write
}
```

### Defaults

The default `coreInstruction` is a multi-section prompt that:
- Establishes the AI's name as "Metatron" and suppresses underlying model identity
- Instructs the AI to act autonomously, prefer action over clarification, and confirm before irreversible operations
- Sets response format expectations (concise, code blocks with language labels, task summaries)
- Includes a "Personal Data Management" section with explicit behavioural directives for the three AI-managed collections: when to upsert the master profile, how to deduplicate contacts before inserting, and how to set fields like `rrule`, `allDay`, `contactId`, and `status` on schedule events

The default `memory` is an empty string. The default `dbSchema` is a pre-populated Markdown table covering all three AI-managed collections (`master`, `contacts`, `schedule`) with their full field lists, types, and notes — this gives the AI immediate awareness of these collections without requiring a prior `update_db_schema` call. If an existing deployment's stored `SystemInstruction` has an empty `dbSchema`, `getSystemInstruction()` backfills the default schema on read. `memoryEnabled` defaults to `true`.

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

This function assembles the text injected as `systemInstruction` into every LLM call. It reads both the `SystemInstruction` document and the current `AppSettings` in parallel (for timezone and tool availability).

```
<coreInstruction>

---

## Current Date & Time
<formatted date/time in configured timezone>

## Your Memory
<memory content, or "No memories stored yet." if empty>

## Your Database
<dbSchema content, or placeholder text if empty>

## Available Tools          ← always present (core tools are always listed)
- **manage_cronjob**: ...          ← always present
- **manage_pulse**: ...            ← always present
- **web_search**: ...              ← only when Brave Search is configured
- **generate_image**: ...          ← only when an image model is configured
- **edit_image**: ...              ← only when an image model is configured
- **whatsapp_read_messages**: ...  ← only when whatsapp.status === 'connected'
- **whatsapp_send_message**: ...   ← only when whatsapp.status === 'connected'
- **whatsapp_manage_permission**: ... ← only when whatsapp.status === 'connected'
- **whatsapp_list_permissions**: ...  ← only when whatsapp.status === 'connected'

## WhatsApp Permissions     ← only present when whatsapp.status === 'connected'
WhatsApp is connected. Live snapshot of all permission records with canRead/canReply flags.
Also includes a note that contacts with canReply=true receive automatic replies.

## Pulse Status             ← always present when pulse settings exist
Shows: enabled/disabled, interval, active days, quiet hours, pulses fired today,
remaining today, last pulse time, next pulse time, and AI's continuity notes.
```

The `## Available Tools` section is always present because `manage_cronjob` and `manage_pulse` are always listed. Additional optional tool descriptions are appended when their features are active. Each tool description in this section provides usage guidance directly in the system prompt, supplementing the formal tool schema sent to the LLM.

The `## WhatsApp Permissions` section is injected only when `whatsapp.status === 'connected'`. It lists every record in `whatsapp_permissions` so the AI has immediate context without calling `whatsapp_list_permissions` first.

The `## Pulse Status` section shows the current state of the Pulse heartbeat system, including scheduling configuration, daily counters, and the AI's continuity notes. If the AI has written notes, they appear in a separate `## Your Pulse Notes` section.

A dedicated `buildPulsePrompt(settings)` function wraps `buildCombinedPrompt()` and appends pulse-specific execution context (remaining pulses, interval, planning guidance). This is used by `pulseService.ts` when executing autonomous pulses — not by regular chat sessions.

If `coreInstruction` is blank (whitespace only), the function returns `null` and no system instruction is sent.

---

## AI Tool Callbacks (`src/services/aiTools.ts`)

`createAIToolCallbacks()` returns an `AIToolCallbacks` object used by both LLM adapters. Each method returns a JSON string — the serialised result that is fed back to the model as the function call response.

```typescript
interface AIToolCallbacks {
  saveMemory: (memory: string) => Promise<string>;
  dbQuery: (operation: MongoOperation) => Promise<string>;
  updateDbSchema: (schema: string) => Promise<string>;
  manageCronjob: (action: string, params: object) => Promise<string>;
  managePulse: (action: string, notes?: string, enabled?: boolean, activeDays?: number[], pulsesPerDay?: number, quietHours?: QuietHoursRange[]) => Promise<string>;
  webSearch?: (query: string) => Promise<string>;
  generateImage?: (prompt: string, shortDescription: string) => Promise<string>;
  editImage?: (imageId: string, prompt: string, shortDescription: string) => Promise<string>;
  whatsappReadMessages?: (contact: string | undefined, limit: number) => Promise<string>;
  whatsappSendMessage?: (phone: string, message: string) => Promise<string>;
  whatsappManagePermission?: (action: string, phoneNumber: string, displayName?: string, canRead?: boolean, canReply?: boolean) => Promise<string>;
  whatsappListPermissions?: () => Promise<string>;
}
```

The five core callbacks (`saveMemory`, `dbQuery`, `updateDbSchema`, `manageCronjob`, `managePulse`) are always present. All others are optional and are only included when the relevant feature is available at the time `createAIToolCallbacks()` is called:

- `webSearch` — included when a Brave Search API key is configured in settings
- `generateImage` / `editImage` — included when an image model is configured and `chatId`/`messageId` are provided
- `whatsappReadMessages` / `whatsappSendMessage` / `whatsappManagePermission` / `whatsappListPermissions` — included when `whatsapp.status === 'connected'`

### `saveMemory(memory)`

Calls `updateMemory()` from the system instruction service. Enforces the 4,000-character limit — if exceeded, the returned JSON contains an `error` field and the memory is not written.

Returns: `{ success: true, message: "Memory updated successfully" }` or `{ error: "..." }`.

### `dbQuery(operation)`

Accepts a structured `MongoOperation` object and delegates to `executeAIOperation()` from `src/services/mongoValidator.ts`. The operation is validated (allowed operations, collection access control) before execution.

Return values vary by operation:

| Operation | Return |
|-----------|--------|
| `find` | `{ rows: [...] }` |
| `findOne` | `{ row: doc }` |
| `insertOne` | `{ insertedId: id }` |
| `insertMany` | `{ insertedCount: N }` |
| `updateOne`, `updateMany` | `{ matchedCount: N, modifiedCount: N }` |
| `deleteOne`, `deleteMany` | `{ deletedCount: N }` |
| `countDocuments` | `{ count: N }` |
| `aggregate` | `{ rows: [...] }` |
| `createCollection`, `createIndex` | `{ success: true }` |
| `listCollections` | `{ collections: [...] }` |

Any exception from MongoDB is caught and returned as `{ error: "..." }`.

### `updateDbSchema(schema)`

Calls `updateDbSchema()` from the system instruction service to store the AI's own Markdown documentation of its collections.

Returns: `{ success: true, message: "Schema updated successfully" }` or `{ error: "..." }`.

### `manageCronjob(action, params)`

Manages recurring scheduled tasks. Delegates to the CRUD functions in `src/services/cronService.ts`. This callback is always present (not conditional).

| Action | Required params | Description |
|--------|----------------|-------------|
| `create` | `name`, `instruction`, `cron_expression` | Creates a new cronjob with a dedicated chat |
| `list` | (none) | Returns all cronjobs |
| `update` | `job_id`, plus any of `name`, `instruction`, `cron_expression`, `enabled` | Updates an existing cronjob |
| `delete` | `job_id` | Deletes the cronjob and its dedicated chat |
| `toggle` | `job_id` | Toggles the cronjob's enabled state |

Returns vary by action: `create` returns the new job object, `list` returns `{ jobs: [...] }`, `update`/`toggle` return the updated job, `delete` returns `{ success: true }`. Invalid actions return `{ error: "..." }`.

### `managePulse(action, ...params)`

Manages the Pulse heartbeat system — the AI's autonomous periodic execution. This callback is always present (not conditional). Delegates to the CRUD functions in `src/services/pulseService.ts`.

| Action | Required params | Description |
|--------|----------------|-------------|
| `update_notes` | `notes` | Saves continuity notes (max 2,000 chars) for the next pulse |
| `get_config` | (none) | Returns the full pulse configuration + remaining pulses today + next pulse time + interval |
| `update_config` | Any of `enabled`, `active_days`, `pulses_per_day`, `quiet_hours` | Updates pulse settings; `pulses_per_day` must be one of 48, 24, 12, 6, or 2 |

Returns: `update_notes` returns `{ success: true, action: "notes_updated", length }`. `get_config` returns the full `PulseSettings` object merged with computed fields (`remaining`, `nextPulseAt`, `intervalMinutes`). `update_config` returns `{ success: true, action: "config_updated", pulse: {...} }`. Invalid actions return `{ error: "..." }`.

---

## MongoDB Sandbox (`src/services/mongoValidator.ts`)

`validateMongoOperation(op)` enforces access control on AI database operations:

### Protected collections

```typescript
const PROTECTED_COLLECTIONS = new Set([
  'chats', 'messages', 'settings', 'media', 'attachments',
]);
```

Protected collections are **read-only** for AI. The AI can `find`, `findOne`, `countDocuments`, and `aggregate` against them, but cannot `insertOne`, `updateOne`, `deleteOne`, etc.

### AI-managed collections

```typescript
const AI_MANAGED_COLLECTIONS = new Set([
  'master', 'contacts', 'schedule', 'cronjobs',
]);
```

These collections have predefined schemas (defined in `src/db/schema.ts`) and support full AI read/write without requiring the `ai_` prefix. The AI uses them for storing the user's profile, contacts, calendar events, and recurring tasks. Note that the AI primarily interacts with `cronjobs` through the `manage_cronjob` tool rather than `db_query`, but the collection is included in the whitelist for direct access if needed.

### Write restriction

Write operations (`insertOne`, `insertMany`, `updateOne`, `updateMany`, `deleteOne`, `deleteMany`, `createCollection`, `createIndex`) are allowed on:
1. **AI-managed collections** — `master`, `contacts`, `schedule`, `cronjobs`
2. **Custom `ai_`-prefixed collections** — any name starting with `ai_` (e.g., `ai_notes`)

All other collection names are blocked for writes:

```typescript
// Allowed — AI-managed collection
{ operation: "updateOne", collection: "master", filter: {}, update: { $set: { city: "Paris" } } }

// Allowed — ai_ prefix
{ operation: "insertOne", collection: "ai_notes", data: { title: "Hello" } }

// Blocked — protected collection
{ operation: "insertOne", collection: "chats", data: { ... } }
// Error: "Access denied: 'chats' is a protected core collection..."

// Blocked — not AI-managed and no ai_ prefix
{ operation: "insertOne", collection: "notes", data: { ... } }
// Error: "Write operations are restricted to AI-managed collections (master, contacts, schedule, cronjobs) or collections with the 'ai_' prefix..."
```

### Allowed operations

`find`, `findOne`, `insertOne`, `insertMany`, `updateOne`, `updateMany`, `deleteOne`, `deleteMany`, `countDocuments`, `aggregate`, `createCollection`, `createIndex`, `listCollections`

Any operation not in this whitelist is rejected before it reaches MongoDB.

---

## Function-Calling Integration

### When tools are active

Tools are passed to the LLM only when `systemInstruction.memoryEnabled` is `true`. The stream route in `src/routes/chats.ts` checks this flag:

```typescript
const sysInstr = await getSystemInstruction();
const toolCallbacks = sysInstr.memoryEnabled ? createAIToolCallbacks() : null;
```

`toolCallbacks` (or `null`) is passed through to both `streamGeminiChat()` and `streamOpenAIChat()`.

### Tools exposed to the LLM

The four core tools are always present. Optional tools are registered only when the corresponding callback exists in `AIToolCallbacks` at call time.

**Always active (when `memoryEnabled` is true):**

| Tool name | Trigger | Action |
|-----------|---------|--------|
| `save_memory` | AI decides to remember something | Replaces the entire memory blob; new content is injected in the next session |
| `db_query` | AI needs to store or retrieve structured data | Executes a MongoDB operation; write access allowed on AI-managed collections (`master`, `contacts`, `schedule`, `cronjobs`) and `ai_`-prefixed collections |
| `update_db_schema` | AI creates or modifies a custom `ai_` collection | Updates the schema documentation shown in future sessions (the built-in AI-managed collections are pre-documented and do not require this call) |
| `manage_cronjob` | AI needs to create, list, update, delete, or toggle a recurring task | Delegates to `cronService.ts` CRUD functions; actions: `create`, `list`, `update`, `delete`, `toggle` |
| `manage_pulse` | AI needs to read/write pulse configuration or save continuity notes | Delegates to `pulseService.ts`; actions: `update_notes`, `get_config`, `update_config` |

**Conditionally active:**

| Tool name | Condition | Action |
|-----------|-----------|--------|
| `web_search` | Brave Search API key configured | Searches the web via Brave Search API |
| `generate_image` | Image model configured | Generates a new image; saves to disk and records in the `media` collection |
| `edit_image` | Image model configured | Edits a previously generated image by its `mediaId` |
| `whatsapp_read_messages` | `whatsapp.status === 'connected'` | Returns recent messages filtered to contacts with `canRead` permission |
| `whatsapp_send_message` | `whatsapp.status === 'connected'` | Sends a text message to a contact with `canReply` permission; adapters instruct the AI to confirm with the user first |
| `whatsapp_manage_permission` | `whatsapp.status === 'connected'` | Grants, updates, revokes, or removes a contact's read/reply permission in `whatsapp_permissions` |
| `whatsapp_list_permissions` | `whatsapp.status === 'connected'` | Lists all permission records (phoneNumber, displayName, canRead, canReply) |

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
    │  updateMemory() writes to settings collection
    │  (replaces entire memory blob; 4,000-char limit)
    │
    ├─ LLM reads/writes user profile, contacts, or schedule
    │       │
    │       ▼
    │  db_query tool called against master / contacts / schedule
    │  Full read/write — no prefix required
    │  (schemas pre-defined; default dbSchema documents all three)
    │
    ├─ LLM wants to store other structured data
    │       │
    │       ▼
    │  db_query tool called against an ai_-prefixed collection
    │  MongoDB operation executed
    │  (protected collections read-only; non-AI-managed require ai_ prefix)
    │
    └─ LLM creates/modifies a custom ai_ collection
            │
            ▼
       update_db_schema tool called
       Schema doc written to settings collection
       (appears in future sessions under ## Your Database)
```

---

## Constraints and Limits

- Memory blob is capped at **4,000 characters**. Exceeding this causes `updateMemory()` to throw, and the tool response carries an error the LLM sees.
- The `dbSchema` field has no enforced size limit. It is the AI's own documentation and is expected to be concise Markdown.
- Protected collections (`chats`, `messages`, `settings`, `media`, `attachments`) are read-only for AI write operations. The AI can read from them but cannot insert, update, or delete documents.
- AI-managed collections (`master`, `contacts`, `schedule`, `cronjobs`) support full read/write without a prefix. Custom AI collections must use the `ai_` prefix. All AI-writable collections live in the same MongoDB database as the core application collections.
- Pulse notes are capped at **2,000 characters**. Exceeding this causes the notes to be silently truncated to 2,000 characters.
- The `memoryEnabled` toggle disables **all tools** simultaneously — there is no per-tool enable/disable. Setting `memoryEnabled: false` prevents `createAIToolCallbacks()` from being called, so no tools (including `manage_cronjob`, `manage_pulse`, and WhatsApp tools) are passed to the LLM.
- WhatsApp tools (`whatsapp_read_messages`, `whatsapp_send_message`, `whatsapp_manage_permission`, `whatsapp_list_permissions`) are only available when `whatsapp.status === 'connected'`. They are excluded from both the `AIToolCallbacks` object and the `## Available Tools` prompt section when WhatsApp is not connected. `whatsapp_read_messages` and `whatsapp_send_message` enforce contact-level permissions against the `whatsapp_permissions` collection — contacts without a permission record or with the relevant flag set to `false` return an error. See `DOCS/whatsapp.md` for the full WhatsApp integration details.

# Backend Internals

This document covers implementation details that are not obvious from reading the source files in isolation: the database bootstrapping strategy, the encryption wire format, the settings storage model, and the LLM adapter contracts.

## Database

### Connection and configuration (`src/db/index.ts`)

The SQLite file path comes from `DATABASE_URL`. The directory is created with `mkdir -p` semantics before the connection is opened, so a missing `./data/` directory never causes a startup failure.

Two exports are provided:

```typescript
export const sqlite: DatabaseType  // raw better-sqlite3 instance
export const db                    // Drizzle ORM instance wrapping sqlite
```

`sqlite` is used by `src/services/aiTools.ts` to execute arbitrary AI-generated SQL statements. All other application code should use `db` (Drizzle) for type-safe queries scoped to the known schema tables.

Two pragmas are set immediately after opening:

- `journal_mode = WAL` — Write-Ahead Logging allows concurrent reads during a write. With a single-user system the concurrency benefit is minimal, but WAL also improves write throughput on spinning disks.
- `foreign_keys = ON` — SQLite disables foreign key enforcement by default. This pragma must be set per connection. Without it, `DELETE FROM chats` would leave orphaned message rows.

### Schema bootstrap

The backend does not use Drizzle migrations on startup. Instead, `src/db/index.ts` executes `CREATE TABLE IF NOT EXISTS` DDL for all three tables directly via `better-sqlite3`. This means:

- First run creates the tables automatically, no manual step required
- Subsequent runs are idempotent — the `IF NOT EXISTS` guard is a no-op
- Schema changes (adding columns, etc.) are **not** handled by this DDL — they require a migration

For schema evolution, use drizzle-kit:
```bash
# from packages/backend/
npm run db:generate   # writes migration SQL to packages/backend/drizzle/
npm run db:migrate    # applies pending migrations to the live DB
```

The `drizzle.config.ts` points drizzle-kit at `src/db/schema.ts` and uses the same `DATABASE_URL` env var as the runtime server.

### Schema

Three tables:

**`chats`**
```
id          TEXT PRIMARY KEY          -- nanoid
title       TEXT NOT NULL DEFAULT 'New Chat'
provider    TEXT NOT NULL DEFAULT 'gemini'
model       TEXT NOT NULL
created_at  INTEGER NOT NULL          -- Unix timestamp (ms), stored via Drizzle mode: 'timestamp'
updated_at  INTEGER NOT NULL
```

**`messages`**
```
id          TEXT PRIMARY KEY
chat_id     TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE
role        TEXT NOT NULL             -- 'user' | 'assistant'
content     TEXT NOT NULL
created_at  INTEGER NOT NULL
```

**`settings`**
```
key         TEXT PRIMARY KEY
value       TEXT NOT NULL
```

`chats.updated_at` is updated on every message insertion via explicit `db.update()` calls in the route handler — Drizzle does not have automatic timestamp triggers. If you add a route that creates or modifies a chat, remember to update `updatedAt` manually.

### Drizzle ORM usage pattern

The `db` export from `src/db/index.ts` is a Drizzle instance. All queries use the Drizzle query builder. Because `better-sqlite3` is synchronous, Drizzle's better-sqlite3 adapter returns results synchronously even though the method signatures are async-compatible.

Common patterns used in the codebase:

```typescript
// Select all, ordered
db.select().from(chats).orderBy(desc(chats.updatedAt)).all()

// Select one or undefined
db.select().from(chats).where(eq(chats.id, id)).get()

// Insert
db.insert(messages).values({ id, chatId, role, content, createdAt }).run()

// Upsert (used for settings)
db.insert(settings)
  .values({ key, value })
  .onConflictDoUpdate({ target: settings.key, set: { value } })
  .run()

// Update
db.update(chats)
  .set({ title, updatedAt: new Date() })
  .where(eq(chats.id, id))
  .run()

// Delete
db.delete(chats).where(eq(chats.id, id)).run()
```

---

## Encryption (`src/services/encryption.ts`)

API keys are encrypted before being written to the database and decrypted when the LLM service needs to make a request. Encryption is never applied at the transport layer (that is TLS's job) — it protects data at rest in the SQLite file.

### Algorithm

AES-256-GCM with scrypt key derivation.

- **Cipher**: AES-256-GCM (authenticated encryption — provides both confidentiality and integrity)
- **Key derivation**: scrypt via Node.js `crypto.scryptSync`. A fresh 16-byte random salt is generated for every encryption operation, so the same plaintext always produces a different ciphertext.
- **Nonce (IV)**: 12 bytes, randomly generated per operation (standard GCM recommendation)
- **Auth tag**: 16 bytes (GCM default)

### Wire format

The output of `encrypt()` is a single base64-encoded blob. The raw bytes before base64 encoding are laid out as:

```
[ salt (16 bytes) ][ iv (12 bytes) ][ tag (16 bytes) ][ ciphertext (variable) ]
```

Total overhead over plaintext: 44 bytes (before base64 expansion). Base64 expands by ~33%.

`decrypt()` reads the offsets back in the same order. The key is re-derived from the salt on every decrypt call — there is no key caching.

### Key derivation

```typescript
scryptSync(ENCRYPTION_SECRET, salt, 32)
//         ↑ passphrase         ↑ random per-encryption  ↑ 256-bit output
```

`ENCRYPTION_SECRET` is the `ENCRYPTION_SECRET` environment variable. In development it falls back to the hard-coded string `"metatron-dev-secret-change-in-production"`. **This default must not be used in production.** A minimum of 32 random characters is recommended; use `openssl rand -base64 32` to generate one.

scrypt's work factors use `crypto.scryptSync`'s defaults (`N=16384, r=8, p=1`). These are appropriate for occasional key derivation (settings saves/loads) but not suitable for high-frequency use.

### API key masking

`maskApiKey(key)` is used in the settings routes to avoid ever returning a real API key to the browser:

```typescript
maskApiKey("sk-abc123xyz7890")  →  "sk-a••••••••7890"
//         ↑ first 4 chars              ↑ last 4 chars
```

If the key is 8 characters or shorter, the entire key is replaced with `"••••••••"`.

---

## Settings service (`src/services/settings.ts`)

Settings are stored as a single serialised JSON object under the key `'app_settings'` in the `settings` table. There is one row, one key, one value — no per-field rows.

### Stored vs. returned representation

The same `AppSettings` interface is used for both the stored blob and the in-memory representation, but the stored blob contains **encrypted** API keys while the in-memory representation contains **plaintext** keys.

Three exported functions:

| Function | Returns | API keys |
|----------|---------|----------|
| `getSettings()` | `AppSettings` | As stored (encrypted ciphertext strings) |
| `getDecryptedSettings()` | `AppSettings` | Decrypted to plaintext |
| `updateSettings(partial)` | `AppSettings` (plaintext) | Encrypts before writing; returns plaintext |

The routes layer uses:
- `getSettings()` in the settings GET route — because keys are then immediately masked before returning, so decryption is not needed
- `getDecryptedSettings()` in the chat stream route — because the LLM services need the real key

If a stored API key fails decryption (e.g., `ENCRYPTION_SECRET` was rotated), `getDecryptedSettings()` silently returns `""` for that key rather than throwing, to avoid crashing the server at startup.

### Defaults

```typescript
const DEFAULTS: AppSettings = {
  gemini: {
    apiKey: '',
    defaultModel: 'gemini-3-pro-preview',
    thinkingLevel: 'MEDIUM',
    imageModel: 'gemini-3-pro-image-preview',
  },
  openai: {
    apiKey: '',
    defaultModel: 'gpt-5.2',
    reasoningEffort: 'medium',
    imageModel: 'gpt-image-1',
  },
};
```

These are returned when the `app_settings` key does not exist (first run) or when the stored JSON cannot be parsed.

### Partial update merge

`updateSettings(partial)` performs a shallow merge per provider:

```typescript
const updated = {
  gemini: { ...current.gemini, ...(partial.gemini ?? {}) },
  openai: { ...current.openai, ...(partial.openai ?? {}) },
};
```

This means you can update `defaultModel` for gemini without touching `apiKey`, and vice versa. However, if you send `partial.gemini = { apiKey: "" }`, the other gemini fields will **not** be cleared — they retain their current values from the merge.

---

## System instruction service (`src/services/systemInstruction.ts`)

Stores the AI's combined system prompt configuration as a JSON blob in the `settings` table under the key `system_instruction`. See `DOCS/ai-tools.md` for full coverage. Key points relevant to the internals:

- `buildCombinedPrompt()` returns `null` when `coreInstruction` is blank — the adapters treat a null system instruction as "don't set a system prompt".
- `updateMemory()` enforces a hard 4,000-character limit before calling `updateSystemInstruction()`. This is the only field with a size constraint.
- All writes stamp `updatedAt` with `new Date().toISOString()` server-side; the client never provides this field.

## AI tool callbacks (`src/services/aiTools.ts`)

Provides `createAIToolCallbacks()` which returns the three tool implementations (`saveMemory`, `dbQuery`, `updateDbSchema`). All methods return JSON strings (the serialised result fed back to the LLM). `dbQuery` uses the raw `sqlite` export from `src/db/index.ts` to execute arbitrary SQL, guarded by `validateAIQuery()`. See `DOCS/ai-tools.md` for full coverage.

## SQL validator (`src/services/sqlValidator.ts`)

Single exported function `validateAIQuery(sql)`. Tests the SQL string against word-boundary regexes for each of the three protected table names (`chats`, `messages`, `settings`). Returns `{ valid: true }` or `{ valid: false, error: string }`. The check is intentionally simple — it uses a regex against the raw SQL text rather than parsing an AST, which is an accepted trade-off in a single-user trusted environment.

---

## LLM adapters

Both adapters (`src/services/llm/gemini.ts`, `src/services/llm/openai.ts`) follow the same callback-based streaming interface, extended with optional system instruction and tool callbacks:

```typescript
// Shared fields across both adapters
interface StreamOptions {
  apiKey: string;
  model: string;
  // provider-specific config (thinkingLevel or reasoningEffort)
  // provider-specific message format (history[] for Gemini, messages[] for OpenAI)
  systemInstruction?: string | null;    // assembled by buildCombinedPrompt()
  toolCallbacks?: AIToolCallbacks | null; // null when memoryEnabled is false
  onChunk: (text: string) => void;      // called for each text chunk
  onDone: () => void;                   // called when stream ends normally
  onError: (err: Error) => void;        // called on failure
}
```

Both functions are `async` but the route handler does **not** `await` them — it fires them and immediately begins writing SSE. The `onChunk`, `onDone`, and `onError` callbacks write to `reply.raw` (the Node.js `http.ServerResponse`). This is intentional: Fastify's reply is passed to the underlying response before the adapter finishes, and the SSE write path bypasses Fastify's serialisation layer.

### Gemini adapter

Uses `@google/genai` SDK version 1.42.0 (`GoogleGenAI`). The API uses a chat session with history rather than a stateless messages array.

The chat is created with `ai.chats.create({ model, config, history })`. The `config` object is built dynamically:

- `thinkingConfig.thinkingBudget` is always set (see budget table below)
- `systemInstruction` is added if non-null
- `tools` and `toolConfig` are added only when `toolCallbacks` is non-null

**Thinking budget mapping** (`thinkingLevel` → `thinkingBudget` token count):

| Level | Budget (tokens) |
|-------|----------------|
| `MINIMAL` | 512 |
| `LOW` | 1024 |
| `MEDIUM` | 4096 |
| `HIGH` | 8192 |

History messages use Gemini's role names: `'user'` and `'model'` (not `'assistant'`). The adapter maps `'assistant'` → `'model'` when building the history array in the route handler.

**Function-calling loop**: After each `sendMessageStream()` call, the adapter collects any `functionCalls` from the chunks. If any are present, it executes them all via `executeFunctionCalls()` (which calls the appropriate `AIToolCallbacks` method), then sends the resulting `Part[]` array back to the chat session via another `sendMessageStream()`. This loop continues until a turn produces no function calls. `FunctionCallingConfigMode.AUTO` allows Gemini to decide per-turn whether to use a tool or respond directly.

Array results from `dbQuery` are wrapped in `{ data: [...] }` before being returned to Gemini, because the SDK requires function responses to be JSON objects (Struct), not arrays.

### OpenAI adapter

Uses the official `openai` npm package. Messages use the standard OpenAI format (`role: 'user' | 'assistant' | 'system'`, `content: string`).

If `systemInstruction` is provided, it is prepended to the messages array as a `{ role: 'system', content }` message.

**With tools** (`toolCallbacks` non-null): uses `client.beta.chat.completions.runTools()`. This SDK helper manages the function-calling loop internally. The `content` delta events are forwarded via `onChunk`. `runner.finalChatCompletion()` is awaited before `onDone()` is called.

**Without tools** (`toolCallbacks` is null): uses the standard `client.chat.completions.create({ stream: true })` path.

The `reasoning_effort` parameter is passed in both paths. It is cast to `ChatCompletionCreateParamsStreaming['reasoning_effort']`. If the selected model does not support this parameter, the OpenAI API will return an error which surfaces as an SSE `error` event.

---

## Server entry point (`src/index.ts`)

Fastify is instantiated with:
- Pretty-print logger in development (`NODE_ENV === 'development'`), JSON logger otherwise
- CORS restricted to `FRONTEND_ORIGIN` with `credentials: true`

Plugins and routes are registered with `await fastify.register(...)`. Fastify 5 requires awaiting plugin registration — missing `await` causes routes to not be registered before the server starts listening.

Three route modules are registered: `chatRoutes`, `settingsRoutes`, and `systemInstructionRoutes`.

In production (`NODE_ENV !== 'development'`), `@fastify/static` is registered to serve the built frontend from `packages/frontend/dist/`. A `setNotFoundHandler` SPA fallback serves `index.html` for any route not matched by the API, enabling React Router's client-side routing.

The server binds to `HOST:PORT`. `HOST` defaults to `0.0.0.0` (all interfaces), which is correct for a containerised deployment where the Docker port mapping controls external access.

Any startup error (plugin registration failure, port already in use, etc.) is logged and the process exits with code `1` — there is no retry logic.

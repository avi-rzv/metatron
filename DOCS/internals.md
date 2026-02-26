# Backend Internals

This document covers implementation details that are not obvious from reading the source files in isolation: the database setup, the encryption wire format, the settings storage model, and the LLM adapter contracts.

## Database

### Connection and configuration (`src/db/index.ts`)

MongoDB connection is established on module import via top-level `await`. The URI and database name come from environment variables:

| Variable | Default |
|----------|---------|
| `MONGODB_URI` | `mongodb://127.0.0.1:27017` |
| `MONGODB_DB` | `metatron` |

Ten typed collection accessors are exported — five core application collections, four AI-managed collections, and one WhatsApp-specific collection:

```typescript
// Core application collections
export const chatsCol: Collection<Chat>
export const messagesCol: Collection<Message>
export const settingsCol: Collection<Setting>
export const mediaCol: Collection<MediaDoc>
export const attachmentsCol: Collection<AttachmentDoc>

// AI-managed collections
export const masterCol: Collection<Master>
export const contactsCol: Collection<Contact>
export const scheduleCol: Collection<ScheduleEvent>
export const cronjobsCol: Collection<CronJob>

// WhatsApp permission collection
export const waPermissionsCol: Collection<WhatsAppPermission>
```

The raw `client` and `database` objects are also exported — `database` is used by `src/services/mongoValidator.ts` to execute AI-generated operations against arbitrary collections, while application code should always use the typed collection accessors.

Indexes are created on startup via `createIndex()` calls (idempotent — no error if they already exist). See `DOCS/database.md` for the full index list.

Graceful shutdown handlers on `SIGINT` and `SIGTERM` call `client.close()`.

### Schema

Document interfaces are defined in `src/db/schema.ts` as plain TypeScript interfaces. All `_id` fields use nanoid strings (not MongoDB ObjectId). See `DOCS/database.md` for full interface definitions.

Ten collections in total. Five core application collections: `chats`, `messages`, `settings`, `media`, `attachments`. Four AI-managed collections: `master`, `contacts`, `schedule`, `cronjobs`. One WhatsApp-specific collection: `whatsapp_permissions`.

`chats.updatedAt` is updated on every message insertion via explicit `updateOne()` calls in the route handler — there are no automatic timestamp triggers. If you add a route that creates or modifies a chat, remember to update `updatedAt` manually.

### ID mapping

MongoDB documents use `_id` as the primary key, but the frontend API expects `id`. The `toApiDoc()` and `toApiDocs()` helpers in `src/db/utils.ts` handle this conversion. All route handlers call these before returning documents.

### Cascading deletes

MongoDB has no foreign key constraints. Application-level cascading deletes are implemented in `src/db/cascade.ts`:

- `deleteChat(chatId)` — deletes the chat, all its messages, media (with files), attachments (with files), and any linked cronjobs (unscheduled and deleted). Also checks if the deleted chat is the pulse chat and clears `pulse.chatId` in settings if so (the next pulse will create a fresh chat).
- `deleteCronJob(jobId)` — unschedules the job, deletes the cronjob document, then cascade-deletes the dedicated chat. Uses a deferred registration pattern (`registerCronUnschedule()`) to break the circular import between `cascade.ts` and `cronService.ts`.
- `deleteMessage(messageId)` — deletes the message and its media and attachments (with files)

Two deferred registration functions break circular imports:
- `registerCronUnschedule(fn)` — called by `cronService.ts` at startup
- `registerPulseChatCleanup(fn)` — called by `pulseService.ts` at startup

All delete functions remove disk files in parallel and silently ignore missing files.

### Common query patterns

All queries are async (unlike the previous SQLite/Drizzle setup which was synchronous):

```typescript
// Select all, ordered
await chatsCol.find().sort({ updatedAt: -1 }).toArray()

// Select one or null
await chatsCol.findOne({ _id: id })

// Insert
await messagesCol.insertOne({ _id: nanoid(), chatId, role, content, citations: null, createdAt: new Date() })

// Upsert (used for settings)
await settingsCol.updateOne({ _id: key }, { $set: { value } }, { upsert: true })

// Update
await chatsCol.updateOne({ _id: id }, { $set: { title, updatedAt: new Date() } })

// Delete
await chatsCol.deleteOne({ _id: id })
```

---

## Encryption (`src/services/encryption.ts`)

API keys are encrypted before being written to the database and decrypted when the LLM service needs to make a request. Encryption is never applied at the transport layer (that is TLS's job) — it protects data at rest in the MongoDB database.

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

Settings are stored as a single serialised JSON object under the `_id` of `'app_settings'` in the `settings` collection. There is one document, one key, one value — no per-field documents.

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
  primaryModel: { modelId: 'gemini-3.1-pro-preview', thinkingLevel: 'medium' },
  fallbackModels: [],
  primaryImageModel: 'gemini-3-pro-image-preview',
  fallbackImageModels: [],
  apiKeys: { gemini: { apiKey: '' }, openai: { apiKey: '' } },
  timezone: 'UTC',
  tools: { braveSearch: { enabled: false, apiKey: '' } },
  pulse: {
    enabled: false,
    activeDays: [0, 1, 2, 3, 4, 5, 6],
    pulsesPerDay: 12,
    quietHours: [{ start: '23:00', end: '07:00' }],
    chatId: null,
    notes: '',
    lastPulseAt: null,
    pulsesToday: 0,
    todayDate: null,
  },
};
```

These are returned when the `app_settings` document does not exist (first run) or when the stored JSON cannot be parsed.

### Partial update merge

`updateSettings(partial)` performs a shallow merge over the current settings. You can update individual fields without affecting others. API key handling is special: only newly provided keys are encrypted; existing keys are preserved as-is from the current stored value. The `pulse` sub-object is merged field-by-field (same pattern as `tools`) — omitted pulse fields retain their current values.

---

## System instruction service (`src/services/systemInstruction.ts`)

Stores the AI's combined system prompt configuration as a JSON blob in the `settings` collection under the `_id` `'system_instruction'`. See `DOCS/ai-tools.md` for full coverage. Key points relevant to the internals:

- `getRaw()` and `setRaw()` are now `async` functions that use `settingsCol.findOne()` and `settingsCol.updateOne()` with upsert
- `buildCombinedPrompt()` returns `null` when `coreInstruction` is blank — the adapters treat a null system instruction as "don't set a system prompt".
- `updateMemory()` enforces a hard 4,000-character limit before calling `updateSystemInstruction()`. This is the only field with a size constraint.
- All writes stamp `updatedAt` with `new Date().toISOString()` server-side; the client never provides this field.

## AI tool callbacks (`src/services/aiTools.ts`)

Provides `createAIToolCallbacks()` which returns an `AIToolCallbacks` object used by both LLM adapters. The five core callbacks (`saveMemory`, `dbQuery`, `updateDbSchema`, `manageCronjob`, `managePulse`) are always included. Optional callbacks are conditionally added based on runtime state:

- `webSearch` — added when a Brave Search API key is present in settings
- `generateImage` / `editImage` — added when an image model is configured and `chatId`/`messageId` context is provided
- `whatsappReadMessages` / `whatsappSendMessage` / `whatsappManagePermission` / `whatsappListPermissions` — added when `whatsapp.status === 'connected'`; `whatsappReadMessages` and `whatsappSendMessage` enforce contact-level permissions against `whatsapp_permissions`

The `manageCronjob` callback delegates to the CRUD functions in `src/services/cronService.ts` and supports five actions: `create`, `list`, `update`, `delete`, `toggle`. The `managePulse` callback delegates to `src/services/pulseService.ts` and supports three actions: `update_notes`, `get_config`, `update_config`.

All callbacks return JSON strings (the serialised result fed back to the LLM). `dbQuery` accepts a structured `MongoOperation` object and delegates to `executeAIOperation()` from `src/services/mongoValidator.ts`. See `DOCS/ai-tools.md` for full coverage and `DOCS/whatsapp.md` for WhatsApp-specific details.

## MongoDB validator (`src/services/mongoValidator.ts`)

`validateMongoOperation(op)` checks a structured MongoDB operation against a whitelist of allowed operations and enforces access control on protected collections. `executeAIOperation(op)` validates and then executes the operation against the database.

Three access tiers are enforced: protected core collections (`chats`, `messages`, `settings`, `media`, `attachments`) are read-only for AI; AI-managed collections (`master`, `contacts`, `schedule`, `cronjobs`) allow full read/write without a prefix; all other write operations require the `ai_` prefix. See `DOCS/ai-tools.md` for the full access control rules.

---

## Pulse service (`src/services/pulseService.ts`)

The Pulse service implements an autonomous heartbeat that periodically wakes the AI to review data, organize information, and take proactive actions without user interaction.

### Architecture

Unlike cronjobs (which use `node-cron` with arbitrary cron expressions), Pulse uses a simple 60-second `setInterval` tick loop. Each tick re-reads settings from the database and checks whether a pulse should fire. This design means settings changes take effect within 60 seconds without re-scheduling.

### Tick loop

1. Every 60 seconds, the tick handler reads `AppSettings` from the database
2. `shouldPulseNow(settings)` checks: enabled, active day (in user's timezone), not in quiet hours, and enough time elapsed since last pulse
3. If conditions are met, the pulse execution is queued in an `AsyncQueue` (same serial-execution pattern as `cronService.ts`)

### Pulse execution

`executePulse()` mirrors the `executeCronJob()` pattern:

1. Re-reads settings from DB (guards against stale queue entries)
2. Re-checks `shouldPulseNow()`
3. Gets or creates a dedicated "Pulse" chat (recreates if deleted)
4. Resets `pulsesToday` counter if the date has changed (user's timezone)
5. Inserts a hardcoded pulse instruction as a user message (includes the AI's continuity notes)
6. Loads last 20 messages for context
7. Builds system prompt via `buildPulsePrompt()` (wraps `buildCombinedPrompt()` with pulse-specific context)
8. Streams LLM response with full tool access
9. Updates `lastPulseAt`, increments `pulsesToday`, persists to settings
10. 180-second LLM timeout (longer than cron's 120s — pulses may do more work)

### Quiet hours

`isInQuietHours()` handles overnight ranges (e.g. 23:00→07:00): if `start > end`, the range wraps around midnight.

### No new collection

Pulse configuration lives in `AppSettings.pulse` — no separate MongoDB collection. Execution history is stored as messages in the dedicated pulse chat. The AI's continuity notes are in `pulse.notes`.

### Exported functions

| Function | Description |
|----------|-------------|
| `initPulseService()` | Starts the 60s tick loop and registers cascade cleanup |
| `stopPulseService()` | Clears the interval |
| `updatePulseSettings(partial)` | Updates only pulse fields in settings |
| `getPulseSettings()` | Returns current `PulseSettings` |
| `updatePulseNotes(notes)` | Saves notes (truncated to 2,000 chars) |
| `getPulseInfo(settings)` | Returns `{ remaining, nextPulseAt, intervalMinutes }` |

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

**Important**: The `onDone` and `onError` callbacks in `src/routes/chats.ts` are now `async` functions because they perform `await` MongoDB operations (updating or deleting the assistant message). The LLM adapters must handle async callbacks properly.

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

Nine route modules are registered: `chatRoutes`, `settingsRoutes`, `systemInstructionRoutes`, `mediaRoutes`, `uploadRoutes`, `voiceRoutes`, `whatsappRoutes`, `whatsappPermissionRoutes`, and `cronjobRoutes`.

After route registration, three background services are initialised:
1. `initWhatsAppAutoReply()` from `src/services/whatsappAutoReply.ts` — registers a listener on the WhatsApp service's `message` event and starts the serial auto-reply queue. See `DOCS/whatsapp.md` for the full auto-reply service documentation.
2. `initCronService()` from `src/services/cronService.ts` — loads all enabled cronjobs from the database, schedules them with `node-cron`, and registers the unschedule callback with the cascade module. Logs the number of jobs scheduled on startup.
3. `initPulseService()` from `src/services/pulseService.ts` — starts a 60-second tick loop that checks whether a pulse should fire, and registers the pulse chat cleanup callback with the cascade module.

In production (`NODE_ENV !== 'development'`), `@fastify/static` is registered to serve the built frontend from `packages/frontend/dist/`. A `setNotFoundHandler` SPA fallback serves `index.html` for any route not matched by the API, enabling React Router's client-side routing.

The server binds to `HOST:PORT`. `HOST` defaults to `0.0.0.0` (all interfaces), which is correct for a containerised deployment where the Docker port mapping controls external access.

Any startup error (plugin registration failure, port already in use, MongoDB connection failure, etc.) is logged and the process exits with code `1` — there is no retry logic.

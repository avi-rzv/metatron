# API Reference

Base URL in development: `http://localhost:4000`
Base URL in production: same host as the frontend (backend serves the SPA as static files)

All request and response bodies are JSON unless noted. The frontend always calls APIs at `/api/...` using relative URLs — in development Vite proxies these to `:4000`.

---

## Health check

### GET /health

Returns server liveness. No authentication required.

**Response `200`**
```json
{ "status": "ok", "timestamp": "2026-02-21T12:00:00.000Z" }
```

---

## Chats

### GET /api/chats

Returns all chats, ordered by `updated_at` descending (most recently active first).

**Response `200`** — array of `Chat` objects
```json
[
  {
    "id": "V1StGXR8_Z5jdHi6B-myT",
    "title": "Explain monads",
    "provider": "gemini",
    "model": "gemini-3-pro-preview",
    "createdAt": "2026-02-21T10:00:00.000Z",
    "updatedAt": "2026-02-21T10:05:00.000Z"
  }
]
```

---

### POST /api/chats

Creates a new chat session. The chat starts empty; messages are added via the stream endpoint.

**Request body**
```json
{
  "provider": "gemini",
  "model": "gemini-3-pro-preview",
  "title": "Optional title"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `provider` | Yes | `"gemini"` or `"openai"` |
| `model` | Yes | Model ID string (e.g. `"gemini-3-pro-preview"`, `"gpt-5.2"`) |
| `title` | No | Defaults to `"New Chat"`. Overwritten automatically after the first message using the first 60 characters of the user's message. |

**Response `200`** — the created `Chat` object

---

### GET /api/chats/:id

Returns a single chat with its full message history.

**Response `200`**
```json
{
  "id": "V1StGXR8_Z5jdHi6B-myT",
  "title": "Explain monads",
  "provider": "gemini",
  "model": "gemini-3-pro-preview",
  "createdAt": "2026-02-21T10:00:00.000Z",
  "updatedAt": "2026-02-21T10:05:00.000Z",
  "messages": [
    {
      "id": "abc123",
      "chatId": "V1StGXR8_Z5jdHi6B-myT",
      "role": "user",
      "content": "Explain monads",
      "createdAt": "2026-02-21T10:00:01.000Z"
    },
    {
      "id": "def456",
      "chatId": "V1StGXR8_Z5jdHi6B-myT",
      "role": "assistant",
      "content": "A monad is...",
      "createdAt": "2026-02-21T10:00:05.000Z"
    }
  ]
}
```

**Response `404`** — `{ "error": "Chat not found" }`

---

### PATCH /api/chats/:id

Updates the chat title.

**Request body**
```json
{ "title": "New title" }
```

**Response `200`** — the updated `Chat` object (without messages)

---

### DELETE /api/chats/:id

Deletes a chat and all its messages, media, attachments, and any linked cronjobs (cascade delete handled at the application level via `src/db/cascade.ts`).

**Response `204`** — no body

---

### POST /api/chats/:id/stream

Sends a user message and streams the LLM response using Server-Sent Events (SSE).

This is the most complex endpoint. The connection lifecycle is:

1. Client sends a POST with the user message content (and optional `provider`/`model` override)
2. Server saves the user message to the database
3. Server auto-titles the chat if this is the first message
4. Server loads the combined system prompt via `buildCombinedPrompt()` and, if `memoryEnabled` is true, creates AI tool callbacks
5. Server begins streaming from the LLM provider configured on the chat (or the override provider)
6. If the LLM invokes function calls (tools), the server executes them and feeds the results back to the model before continuing the stream
7. Server emits SSE events until the response is complete or an error occurs
8. Server saves the complete assistant message to the database and closes the response

**Request body**
```json
{ "content": "Explain monads in simple terms" }
```

**Response headers**
```
Content-Type: text/event-stream
Cache-Control: no-cache
X-Accel-Buffering: no
Connection: keep-alive
```

The `X-Accel-Buffering: no` header instructs nginx (if present as a reverse proxy) to disable response buffering, ensuring chunks reach the client immediately.

**SSE event types**

All events use the named-event format: `event: <type>\ndata: <json>\n\n`.

| Event | Payload | Description |
|-------|---------|-------------|
| `start` | `{ "messageId": string, "userMessageId": string }` | Emitted once before any content. `messageId` is the ID pre-assigned to the assistant message. `userMessageId` is the ID assigned to the saved user message. |
| `chunk` | `{ "text": string }` | One or more characters of the assistant's response. Accumulate these to build the full response. |
| `done` | `{ "messageId": string }` | Emitted when the stream is complete. The assistant message has been persisted to the database. |
| `error` | `{ "message": string }` | Emitted if the LLM call fails. The connection is closed after this event. No assistant message is saved. |

**Response `404`** — chat not found (returned as JSON before SSE mode is entered)
**Response `400`** — content is empty (returned as JSON before SSE mode is entered)

**Client-side parsing pattern** (used by `packages/frontend/src/api/index.ts`):

The client reads the response body as a `ReadableStream`, decodes it with `TextDecoder`, and splits on `\n`. Lines beginning with `event: ` set the current event type; lines beginning with `data: ` carry the JSON payload. The event type is reset after each `data` line is processed.

The `streamMessage()` function in `src/api/index.ts` returns an `AbortController`. Call `controller.abort()` to cancel an in-progress stream — the backend will close the connection on the next write attempt.

---

## System Instruction

The system instruction controls the AI's identity, persistent memory, and database access. All fields are stored as a single JSON blob in the `settings` collection under the `_id` `'system_instruction'`. See `DOCS/ai-tools.md` for the full internals.

### GET /api/system-instruction

Returns the current `SystemInstruction` object. If no instruction has been saved yet, returns the built-in defaults (the full Metatron identity prompt, empty memory, `memoryEnabled: true`, empty schema).

**Response `200`** — `SystemInstruction` object

---

### PUT /api/system-instruction

Shallow-merges the supplied partial object over the current instruction and persists it. `updatedAt` is always updated to the current time by the server regardless of what fields are sent.

**Request body** — any subset of `SystemInstruction` fields
```json
{
  "coreInstruction": "You are a helpful assistant.",
  "memoryEnabled": false
}
```

**Response `200`** — the full updated `SystemInstruction` object

---

### DELETE /api/system-instruction/memory

Clears the memory field (sets it to `""`). Used by the System Instruction page "Clear" button in the memory section.

**Response `204`** — no body

---

### DELETE /api/system-instruction/db-schema

Clears the database schema documentation field (sets it to `""`). Used by the System Instruction page "Clear" button in the database schema section.

**Response `204`** — no body

---

## Settings

Settings are stored as a single JSON blob under the `_id` `'app_settings'` in the `settings` collection. API keys within that blob are encrypted with AES-256-GCM before being written. See `DOCS/internals.md` for the encryption details.

### GET /api/settings

Returns current settings with API keys masked. A masked key looks like `sk-p••••••••4321`. The `hasApiKey` boolean indicates whether a key has been configured without exposing any key material.

**Response `200`**
```json
{
  "gemini": {
    "apiKey": "AIza••••••••abcd",
    "hasApiKey": true,
    "defaultModel": "gemini-3-pro-preview",
    "thinkingLevel": "MEDIUM",
    "imageModel": "gemini-3-pro-image-preview"
  },
  "openai": {
    "apiKey": "",
    "hasApiKey": false,
    "defaultModel": "gpt-5.2",
    "reasoningEffort": "medium",
    "imageModel": "gpt-image-1"
  }
}
```

---

### PUT /api/settings

Updates settings. Send only the provider sub-object(s) you want to change. The server merges the partial update over the existing settings using shallow merge per provider.

**Request body** (all fields optional at top level, and within each provider)
```json
{
  "gemini": {
    "apiKey": "AIzaSy...",
    "defaultModel": "gemini-3-flash-preview",
    "thinkingLevel": "HIGH",
    "imageModel": "gemini-3-pro-image-preview"
  },
  "openai": {
    "apiKey": "sk-...",
    "defaultModel": "gpt-5.2",
    "reasoningEffort": "medium",
    "imageModel": "gpt-image-1"
  }
}
```

**Behaviour:**
- If `apiKey` is a non-empty string, it is encrypted before being stored
- If `apiKey` is an empty string `""`, the existing stored key is replaced with an empty encrypted value (effectively clearing it)
- The response mirrors the GET response: masked API keys + `hasApiKey` boolean

**Response `200`** — same shape as GET /api/settings

---

## Data types

### Chat
```typescript
{
  id: string;          // nanoid, primary key
  title: string;       // default "New Chat"; auto-set from first message (60 chars)
  provider: string;    // "gemini" | "openai"
  model: string;       // model identifier string
  createdAt: string;   // ISO 8601 timestamp
  updatedAt: string;   // ISO 8601 timestamp, updated on every message
}
```

### Message
```typescript
{
  id: string;          // nanoid, primary key
  chatId: string;      // references chats (cascade delete handled at app level)
  role: string;        // "user" | "assistant"
  content: string;     // full text content
  citations: Array<{ url: string; title: string }> | null;  // native array, not JSON text
  createdAt: string;   // ISO 8601 timestamp
}
```

### AppSettings (GET response shape)
```typescript
{
  gemini: {
    apiKey: string;        // masked if set, "" if not set
    hasApiKey: boolean;    // true if a real key is stored
    defaultModel: string;
    thinkingLevel: "MINIMAL" | "LOW" | "MEDIUM" | "HIGH";
    imageModel: string;
  };
  openai: {
    apiKey: string;
    hasApiKey: boolean;
    defaultModel: string;
    reasoningEffort: "minimal" | "low" | "medium" | "high";
    imageModel: string;
  };
}
```

### SystemInstruction
```typescript
{
  coreInstruction: string;  // injected verbatim as the LLM system prompt
  memory: string;           // AI-managed bullet-point facts; max 4,000 characters
  memoryEnabled: boolean;   // when false, all tools are disabled
  dbSchema: string;         // AI-managed Markdown docs of ai_ tables
  updatedAt: string;        // ISO 8601 timestamp, set server-side on every write
}
```

### PulseSettings

Nested within `AppSettings` under the `pulse` key. Returned by `GET /api/settings` and `PUT /api/settings`.

```typescript
{
  enabled: boolean;              // whether the pulse system is active
  activeDays: number[];          // days of week (0=Sun..6=Sat)
  pulsesPerDay: number;          // 48 | 24 | 12 | 6 | 2
  quietHours: Array<{            // time ranges where pulses are suppressed
    start: string;               // "HH:mm" 24h format
    end: string;                 // "HH:mm" 24h format
  }>;
  chatId: string | null;         // dedicated pulse chat (created on first pulse)
  notes: string;                 // AI-maintained continuity notes (max 2000 chars)
  lastPulseAt: string | null;    // ISO 8601 timestamp
  pulsesToday: number;           // reset at midnight in user's timezone
  todayDate: string | null;      // "YYYY-MM-DD" for day-boundary detection
}
```

The `pulse` object is included in settings GET/PUT responses. To update pulse settings, send `{ pulse: { enabled, pulsesPerDay, ... } }` to `PUT /api/settings`. Only the fields you include in the `pulse` object are updated; omitted fields retain their current values.

### CronJob

Returned by `GET /api/cronjobs`, `POST /api/cronjobs`, `PATCH /api/cronjobs/:id`, and `POST /api/cronjobs/:id/toggle`.

```typescript
{
  id: string;               // nanoid (mapped from _id)
  name: string;             // human label for the task
  instruction: string;      // what the AI does when triggered
  cronExpression: string;   // standard 5-field cron expression
  timezone: string;         // IANA timezone from settings
  enabled: boolean;         // whether the job is scheduled
  chatId: string;           // dedicated chat for execution results
  lastRunAt: string | null; // ISO 8601 timestamp of last execution
  nextRunAt: string | null; // reserved for future use
  createdAt: string;        // ISO 8601 timestamp
  updatedAt: string;        // ISO 8601 timestamp
}
```

### WhatsAppPermission

Returned by `GET /api/whatsapp/permissions`, `POST /api/whatsapp/permissions`, and `PATCH /api/whatsapp/permissions/:id`.

```typescript
{
  id: string;               // nanoid (mapped from _id)
  phoneNumber: string;      // digits only (e.g. "14155551234")
  displayName: string;      // human label (e.g. "Mom")
  contactId: string | null; // optional link to a contacts document
  canRead: boolean;         // AI can read messages from this contact
  canReply: boolean;        // AI can auto-reply to this contact
  chatId: string | null;    // dedicated chat session ID; null until first auto-reply
  createdAt: string;        // ISO 8601 timestamp
  updatedAt: string;        // ISO 8601 timestamp
}
```

### BufferedMessage

Returned by `GET /api/whatsapp/messages` and the `whatsapp_read_messages` AI tool.

```typescript
{
  id: string;               // Baileys message key ID
  from: string;             // sender JID (e.g. "14155551234@s.whatsapp.net")
  fromName: string | null;  // push name of the sender, or null
  to: string;               // recipient JID
  body: string;             // normalised text content; binary media shown as e.g. "[Image]"
  timestamp: number;        // milliseconds since epoch
  fromMe: boolean;          // true if sent from the linked account
  isGroup: boolean;         // true if the message is from a group chat
}
```

---

## WhatsApp

These endpoints control the WhatsApp Web connection and expose the in-memory message buffer. The connection is managed by the singleton `WhatsAppService` in `src/services/whatsapp.ts`. See `DOCS/whatsapp.md` for full service internals.

### GET /api/whatsapp/status

Returns the current connection status and linked phone number.

**Response `200`**
```json
{
  "status": "connected",
  "phoneNumber": "14155551234"
}
```

`status` is one of `"disconnected"`, `"connecting"`, `"qr_ready"`, `"connected"`. `phoneNumber` is `null` when not connected.

---

### POST /api/whatsapp/connect

Initiates a connection. Fire-and-forget — returns immediately without waiting for authentication. The client should open the QR SSE stream (`GET /api/whatsapp/qr/stream`) after calling this endpoint.

**Response `200`** — already connected
```json
{ "status": "already_connected", "phoneNumber": "14155551234" }
```

**Response `200`** — connection started
```json
{ "status": "connecting" }
```

---

### GET /api/whatsapp/qr

Returns the current QR code as a base64 PNG data URL. Returns `404` if no QR is currently available (i.e. status is not `qr_ready`).

**Response `200`**
```json
{ "qr": "data:image/png;base64,iVBORw0KGgoAAAANS..." }
```

**Response `404`**
```json
{ "error": "No QR code available" }
```

---

### GET /api/whatsapp/qr/stream

Server-Sent Events stream for real-time QR and status updates during the connection flow. Sends a keep-alive comment (`: keep-alive`) every 30 seconds.

**Response headers**
```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

**SSE event types**

| Event | Payload | Description |
|-------|---------|-------------|
| `status` | `{ "status": string, "phoneNumber": string \| null }` | Emitted immediately on connect and on every status change |
| `qr` | `{ "qr": string }` | Base64 PNG data URL; emitted immediately if a QR exists, and on each new QR |
| `connected` | `{ "phoneNumber": string \| null }` | Emitted when authentication succeeds |

---

### POST /api/whatsapp/disconnect

Disconnects from WhatsApp and optionally deletes saved auth credentials.

**Request body**
```json
{ "clearSession": true }
```

`clearSession` defaults to `false`. When `true`, the auth directory (`./data/whatsapp-auth`) is deleted — the next connect will require a new QR scan.

**Response `200`**
```json
{ "status": "disconnected" }
```

---

### GET /api/whatsapp/messages

Returns recent messages from the in-memory buffer.

**Query parameters**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `contact` | string | — | Filter by phone number (digits only, substring match) |
| `limit` | number | 50 | Maximum messages; capped at 100 |

**Response `200`**
```json
{
  "messages": [
    {
      "id": "3EB0A7B1C2D3...",
      "from": "14155551234@s.whatsapp.net",
      "fromName": "Alice",
      "to": "19876543210@s.whatsapp.net",
      "body": "Hey, are you around?",
      "timestamp": 1740567890000,
      "fromMe": false,
      "isGroup": false
    }
  ]
}
```

---

### GET /api/whatsapp/permissions

Returns all permission records sorted alphabetically by `displayName`.

**Response `200`** — array of `WhatsAppPermission` objects
```json
[
  {
    "id": "abc123",
    "phoneNumber": "14155551234",
    "displayName": "Mom",
    "contactId": null,
    "canRead": true,
    "canReply": false,
    "chatId": "xyz789",
    "createdAt": "2026-02-21T10:00:00.000Z",
    "updatedAt": "2026-02-21T10:00:00.000Z"
  }
]
```

---

### POST /api/whatsapp/permissions

Creates a new permission record.

**Request body**
```json
{
  "phoneNumber": "14155551234",
  "displayName": "Mom",
  "canRead": true,
  "canReply": false
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `phoneNumber` | Yes | Digits are extracted automatically; non-digit characters are stripped |
| `displayName` | Yes | Human label for the contact |
| `canRead` | No | Defaults to `false` |
| `canReply` | No | Defaults to `false` |

**Response `200`** — the created `WhatsAppPermission` object

**Response `400`** — missing required fields or invalid phone number

**Response `409`** — a permission already exists for this phone number

---

### PATCH /api/whatsapp/permissions/:id

Updates `displayName`, `canRead`, and/or `canReply` on an existing permission record.

**Request body** — all fields optional
```json
{
  "displayName": "Mum",
  "canRead": true,
  "canReply": true
}
```

**Response `200`** — the updated `WhatsAppPermission` object

**Response `404`** — `{ "error": "Permission not found" }`

---

### DELETE /api/whatsapp/permissions/:id

Permanently removes a permission record.

**Response `200`** — `{ "success": true }`

**Response `404`** — `{ "error": "Permission not found" }`

---

## Cronjobs

These endpoints manage recurring AI tasks. Each cronjob has a dedicated chat where execution results are stored. The cron service uses `node-cron` with the user's configured timezone.

### GET /api/cronjobs

Returns all cronjobs, ordered by `createdAt` descending.

**Response `200`** — array of `CronJob` objects
```json
[
  {
    "id": "abc123",
    "name": "Daily News Summary",
    "instruction": "Summarize today's top tech news",
    "cronExpression": "0 21 * * *",
    "timezone": "Asia/Jerusalem",
    "enabled": true,
    "chatId": "xyz789",
    "lastRunAt": "2026-02-25T21:00:05.000Z",
    "nextRunAt": null,
    "createdAt": "2026-02-20T10:00:00.000Z",
    "updatedAt": "2026-02-25T21:00:05.000Z"
  }
]
```

---

### POST /api/cronjobs

Creates a new cronjob. A dedicated chat is created automatically.

**Request body**
```json
{
  "name": "Daily News Summary",
  "instruction": "Summarize today's top tech news",
  "cronExpression": "0 21 * * *"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Human label for the task |
| `instruction` | Yes | What the AI should do when the job fires |
| `cronExpression` | Yes | Standard 5-field cron expression (e.g. `0 21 * * *`) |

**Response `200`** — the created `CronJob` object

**Response `400`** — missing required fields or invalid cron expression

---

### PATCH /api/cronjobs/:id

Updates `name`, `instruction`, and/or `cronExpression` on an existing cronjob. If the cron expression changes, the job is rescheduled.

**Request body** — all fields optional
```json
{
  "name": "Weekly News Summary",
  "cronExpression": "0 9 * * 1"
}
```

**Response `200`** — the updated `CronJob` object

**Response `404`** — `{ "error": "Cronjob not found" }`

---

### DELETE /api/cronjobs/:id

Deletes a cronjob, unschedules it, and cascade-deletes its dedicated chat (including all messages, media, and attachments).

**Response `204`** — no body

**Response `404`** — `{ "error": "Cronjob not found" }`

---

### POST /api/cronjobs/:id/toggle

Toggles the `enabled` state. When disabled, the job is unscheduled. When enabled, the job is rescheduled.

**Response `200`** — the updated `CronJob` object

**Response `404`** — `{ "error": "Cronjob not found" }`

---

## Error responses

Non-SSE errors are returned as JSON:
```json
{ "error": "Human-readable error message" }
```

Fastify's default error serializer handles uncaught exceptions and produces `{ "statusCode": number, "error": string, "message": string }`.

---

## Known limitations / TODOs

- There is no authentication layer. The system is designed for single-user, private network or VPN use — add an auth plugin (e.g., `@fastify/jwt`) before exposing to the public internet.
- The WebSocket plugin (`@fastify/websocket`) is declared as a dependency but not yet used. It is reserved for future real-time features (PTY sessions, Pulse loop).
- The MongoDB validator in `src/services/mongoValidator.ts` uses a whitelist of allowed operations and enforces collection-level access control (protected collections are read-only; writes require the `ai_` prefix). Because operations are structured JSON objects (not raw query strings), the attack surface is smaller than the previous SQL-based approach.

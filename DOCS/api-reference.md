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

Deletes a chat and all its messages (cascade delete enforced at the database level via the `chat_id` foreign key).

**Response `204`** — no body

---

### POST /api/chats/:id/stream

Sends a user message and streams the LLM response using Server-Sent Events (SSE).

This is the most complex endpoint. The connection lifecycle is:

1. Client sends a POST with the user message content
2. Server saves the user message to the database
3. Server auto-titles the chat if this is the first message
4. Server begins streaming from the LLM provider configured on the chat
5. Server emits SSE events until the response is complete or an error occurs
6. Server saves the complete assistant message to the database and closes the response

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

## Settings

Settings are stored as a single JSON blob under the key `app_settings` in the `settings` table. API keys within that blob are encrypted with AES-256-GCM before being written. See `DOCS/internals.md` for the encryption details.

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
  chatId: string;      // foreign key → chats.id (cascade delete)
  role: string;        // "user" | "assistant"
  content: string;     // full text content
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

---

## Error responses

Non-SSE errors are returned as JSON:
```json
{ "error": "Human-readable error message" }
```

Fastify's default error serializer handles uncaught exceptions and produces `{ "statusCode": number, "error": string, "message": string }`.

---

## Known limitations / TODOs

- Static file serving for the built frontend is not yet configured in `src/index.ts` — `@fastify/static` is declared as a dependency but not registered. Production deployment requires either wiring this up or using a reverse proxy to serve `packages/frontend/dist/`.
- There is no authentication layer. The system is designed for single-user, private network or VPN use — add an auth plugin (e.g., `@fastify/jwt`) before exposing to the public internet.
- The WebSocket plugin (`@fastify/websocket`) is declared as a dependency but not yet used. It is reserved for future real-time features (PTY sessions, Pulse loop).

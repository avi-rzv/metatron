# WhatsApp Integration

This document covers the WhatsApp service, its REST and SSE endpoints, the message buffer, the permission system, the AI tool integration, the auto-reply background service, and the frontend UI.

---

## Overview

MetatronOS integrates with WhatsApp Web via the `@whiskeysockets/baileys` library (v7.0.0-rc.9). The integration runs as a singleton service in the backend process, connecting to WhatsApp through the same multi-device protocol used by WhatsApp Web in a browser.

The connection requires scanning a QR code once. After a successful scan, credentials are persisted to disk and the connection reconnects automatically on restarts without requiring a new QR scan, unless the session is explicitly logged out or the auth files are deleted.

WhatsApp tools are exposed to the AI only when the service is in the `connected` state. They are conditionally registered per-request by `createAIToolCallbacks()` and conditionally injected into the system prompt by `buildCombinedPrompt()`.

A **permission system** (`whatsapp_permissions` MongoDB collection) governs which contacts the AI is allowed to read from or reply to. No contact receives AI attention or auto-replies unless explicitly granted permission. The AI itself can manage permissions through two dedicated tools (`whatsapp_manage_permission`, `whatsapp_list_permissions`).

An **auto-reply background service** (`src/services/whatsappAutoReply.ts`) listens for incoming messages and, for contacts with `canRead` permission, automatically runs the primary LLM against a per-contact dedicated chat session. If `canReply` is also set, the generated response is sent back via WhatsApp.

---

## Service (`src/services/whatsapp.ts`)

### Singleton export

```typescript
import { whatsapp } from './services/whatsapp.js';
```

`whatsapp` is a module-level singleton instance of `WhatsAppService`. There is exactly one WhatsApp connection per backend process.

### Status lifecycle

```
disconnected → connecting → qr_ready → connected
                   ↑              ↓
                   └── reconnect (on non-logout close)
```

```typescript
type WhatsAppStatus = 'disconnected' | 'connecting' | 'qr_ready' | 'connected';
```

| Status | Description |
|--------|-------------|
| `disconnected` | Not connected; no active socket. Initial state and state after a `loggedOut` disconnect or explicit `disconnect()`. |
| `connecting` | `connect()` was called; socket is being established or auth credentials are being loaded. |
| `qr_ready` | A QR code is available to be scanned. The `qrDataUrl` property contains the current QR as a base64 PNG data URL. |
| `connected` | Authenticated and fully connected. The `phoneNumber` property contains the linked phone number. |

### Public API

```typescript
whatsapp.status: WhatsAppStatus          // current connection status
whatsapp.qrDataUrl: string | null        // base64 PNG data URL of current QR, or null
whatsapp.phoneNumber: string | null      // linked number (e.g. "14155551234"), or null

whatsapp.connect(): Promise<void>        // begins connection (no-op if already connected/connecting)
whatsapp.disconnect(clearSession?: boolean): Promise<void>  // disconnect and optionally wipe auth
whatsapp.sendMessage(phone, text): Promise<{ success: boolean; jid: string }>
whatsapp.getMessages(contact?, limit?): BufferedMessage[]
```

`connect()` is fire-and-forget — it starts the connection process and returns immediately. Status changes and QR codes are communicated via EventEmitter events (see below).

`disconnect(clearSession: true)` calls `sock.logout()` and then deletes the auth directory at `./data/whatsapp-auth`. Use this to fully unlink the device. `disconnect(clearSession: false)` (default) closes the socket without deleting credentials — on next `connect()`, the saved session will be used.

### Events

`WhatsAppService` extends `EventEmitter`. The routes and `buildCombinedPrompt()` listen to these events:

| Event | Payload | Emitted when |
|-------|---------|-------------|
| `status` | `WhatsAppStatus` string | Status changes to any value |
| `qr` | `string` (data URL) | A new QR code is generated |
| `connected` | `string \| null` (phone number) | Connection succeeds and phone number is known |
| `logged_out` | none | WhatsApp server signals the device was logged out |
| `message` | `BufferedMessage` | An incoming message is received |

### Message buffer

Incoming messages are stored in an in-memory circular buffer capped at **100 entries** (`BUFFER_MAX = 100`). When the buffer is full, the oldest message is evicted (`shift()`). The buffer is not persisted — it is cleared on backend restart.

```typescript
interface BufferedMessage {
  id: string;          // Baileys message key ID
  from: string;        // JID of the sender (e.g. "14155551234@s.whatsapp.net")
  fromName: string | null;  // push name of the sender, if available
  to: string;          // JID of the recipient
  body: string;        // normalised text content (see content type handling below)
  timestamp: number;   // milliseconds since epoch
  fromMe: boolean;     // true if the message was sent by the linked account
  isGroup: boolean;    // true if the message is from a group chat
}
```

**Content type normalisation**: Only `notify`-type upserts are buffered. Non-text content types are represented as text placeholders:

| Content type | `body` value |
|-------------|-------------|
| `conversation` | Raw message text |
| `extendedTextMessage` | Raw message text |
| `imageMessage` | `[Image] <caption>` or `[Image]` |
| `videoMessage` | `[Video] <caption>` or `[Video]` |
| `documentMessage` | `[Document] <filename>` or `[Document]` |
| `audioMessage` | `[Audio message]` |
| `stickerMessage` | `[Sticker]` |
| anything else | `[<contentType>]` |

`getMessages(contact?, limit?)` filters by contact (numeric digits only, substring match against `from` and `to`) and returns the last `limit` messages (default 50, max enforced by callers).

### Auth persistence

Baileys credentials are persisted to `./data/whatsapp-auth` (relative to the backend working directory, i.e. `packages/backend/data/whatsapp-auth`). This directory is not committed to git — it is created automatically on first `connect()`. The `data/` directory is already covered by `.gitignore`.

On a fresh deployment with no auth files, connecting will always require a QR scan. After a successful scan, subsequent restarts reconnect without a QR.

### Auto-reconnect

When the WebSocket closes for any reason other than `DisconnectReason.loggedOut`, the service waits 3 seconds and calls `reconnect()` automatically. There is no exponential backoff. If the connection drops repeatedly (e.g. network issues), this will retry every 3 seconds indefinitely.

---

## REST and SSE endpoints

Endpoints are split across two route modules, both under the `/api/whatsapp` prefix:

- **`src/routes/whatsapp.ts`** — connection lifecycle, QR, messages
- **`src/routes/whatsappPermissions.ts`** — permission CRUD

### GET /api/whatsapp/status

Returns the current connection status.

**Response `200`**
```json
{
  "status": "connected",
  "phoneNumber": "14155551234"
}
```

`phoneNumber` is `null` when not connected.

---

### POST /api/whatsapp/connect

Initiates a connection. Fire-and-forget — returns immediately without waiting for the QR or authentication to complete.

**Response `200`** — already connected
```json
{ "status": "already_connected", "phoneNumber": "14155551234" }
```

**Response `200`** — connection started
```json
{ "status": "connecting" }
```

After calling this endpoint, the client should open the QR SSE stream (`GET /api/whatsapp/qr/stream`) to receive real-time status and QR code updates.

---

### GET /api/whatsapp/qr

Returns the current QR code as a base64 PNG data URL. Useful for a one-shot fetch when the client already knows a QR is available.

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

Server-Sent Events stream for real-time QR and status updates. The recommended approach for the frontend connection flow.

**Response headers**
```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

A keep-alive comment (`: keep-alive`) is sent every 30 seconds to prevent proxy timeout.

**SSE event types**

| Event | Payload | Description |
|-------|---------|-------------|
| `status` | `{ "status": WhatsAppStatus, "phoneNumber": string \| null }` | Emitted immediately on connect and again on every status change |
| `qr` | `{ "qr": string }` | Base64 PNG data URL; emitted immediately if a QR is already available, and again each time a new QR is generated |
| `connected` | `{ "phoneNumber": string \| null }` | Emitted when the connection is fully established |

The stream stays open until the client closes it. Listeners are cleaned up when the request closes.

---

### POST /api/whatsapp/disconnect

Disconnects from WhatsApp. Optionally clears the saved session (auth files).

**Request body**
```json
{ "clearSession": true }
```

`clearSession` defaults to `false` if omitted.

**Response `200`**
```json
{ "status": "disconnected" }
```

---

### GET /api/whatsapp/messages

Returns recent buffered messages.

**Query parameters**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `contact` | string | — | Filter messages by phone number (numeric digits, substring match) |
| `limit` | number | 50 | Maximum messages to return; capped at 100 |

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

Returns all permission records, sorted alphabetically by `displayName`.

**Response `200`** — array of `WhatsAppPermission` objects (with `id` instead of `_id`)
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

Creates a new permission record for a contact.

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
| `phoneNumber` | Yes | Phone number (non-digit characters stripped automatically) |
| `displayName` | Yes | Human label for the contact (e.g. "Mom") |
| `canRead` | No | Allow AI to read messages from this contact (default `false`) |
| `canReply` | No | Allow AI to auto-reply to this contact (default `false`) |

**Response `200`** — the created `WhatsAppPermission` object

**Response `400`** — `{ "error": "phoneNumber and displayName are required" }` or `{ "error": "Invalid phone number" }`

**Response `409`** — `{ "error": "Permission already exists for this phone number" }` (duplicate phone number)

---

### PATCH /api/whatsapp/permissions/:id

Updates an existing permission record. All fields are optional; only provided fields are changed.

**Request body**
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

Permanently removes a permission record. The AI will no longer be able to read messages from or reply to this contact.

**Response `200`** — `{ "success": true }`

**Response `404`** — `{ "error": "Permission not found" }`

---

## AI Tool Integration

When `whatsapp.status === 'connected'`, `createAIToolCallbacks()` in `src/services/aiTools.ts` includes four additional callbacks:

```typescript
interface AIToolCallbacks {
  // ... always-present callbacks ...
  whatsappReadMessages?: (contact: string | undefined, limit: number) => Promise<string>;
  whatsappSendMessage?: (phone: string, message: string) => Promise<string>;
  whatsappManagePermission?: (action: string, phoneNumber: string, displayName?: string, canRead?: boolean, canReply?: boolean) => Promise<string>;
  whatsappListPermissions?: () => Promise<string>;
}
```

These callbacks are checked at tool call creation time (per-request). If the WhatsApp service disconnects between requests, the next request's callbacks will not include the WhatsApp tools.

Both LLM adapters (`src/services/llm/gemini.ts` and `src/services/llm/openai.ts`) conditionally register the tool declarations only when the corresponding callback exists on the `toolCallbacks` object. This means the tool declarations are dynamically added per-request.

### `whatsapp_read_messages`

```
Tool name:  whatsapp_read_messages
Parameters: contact (string, optional) — phone number to filter by
            limit   (number, optional) — max messages to return (default 20, max 100)
Returns:    { messages: BufferedMessage[] } or { error: "..." }
```

Permission-enforced. If `contact` is specified, the contact's phone number must exist in `whatsapp_permissions` with `canRead: true`; otherwise an error is returned. If no `contact` is provided, the result is filtered to only include messages from contacts that have `canRead: true`. Contacts without a permission record are never returned.

### `whatsapp_send_message`

```
Tool name:  whatsapp_send_message
Parameters: phone   (string, required) — international format, digits only (e.g. "14155551234")
            message (string, required) — text to send
Returns:    { success: true, jid: string } or { error: "..." }
```

Permission-enforced. The contact must have `canReply: true` in `whatsapp_permissions`; otherwise an error is returned. Both LLM adapter descriptions include the instruction "Always confirm with the user before sending."

### `whatsapp_manage_permission`

```
Tool name:  whatsapp_manage_permission
Parameters: action      (string, required)  — one of: "grant", "update", "revoke", "remove"
            phoneNumber (string, required)  — digits only
            displayName (string, optional)  — human label (required when action is "grant")
            canRead     (boolean, optional) — defaults to true on "grant"
            canReply    (boolean, optional) — defaults to false on "grant"
Returns:    { success: true, action: string, phoneNumber: string } or { error: "..." }
```

Manages the `whatsapp_permissions` collection on behalf of the AI. Actions:
- `"grant"` — creates a new permission record (upserts if the number already exists)
- `"update"` — updates `displayName`, `canRead`, and/or `canReply` on an existing record
- `"revoke"` — sets both `canRead` and `canReply` to `false` (record is kept)
- `"remove"` — permanently deletes the permission record

### `whatsapp_list_permissions`

```
Tool name:  whatsapp_list_permissions
Parameters: none
Returns:    { permissions: [{ phoneNumber, displayName, canRead, canReply }] } or { error: "..." }
```

Returns all permission records sorted alphabetically by `displayName`. The AI uses this to understand who it currently has access to before deciding to read or send messages.

### System prompt injection

`buildCombinedPrompt()` in `src/services/systemInstruction.ts` injects two sections into the system prompt when WhatsApp is connected:

1. **`## Available Tools`** — descriptions for all four WhatsApp tools
2. **`## WhatsApp Permissions`** — a live snapshot of all permission records with their `canRead` and `canReply` flags, plus a note that contacts with `canReply: true` receive automatic replies

This gives the LLM immediate awareness of which contacts are accessible without needing to call `whatsapp_list_permissions` first.

---

## Auto-reply background service (`src/services/whatsappAutoReply.ts`)

`initWhatsAppAutoReply()` is called once at server startup from `src/index.ts`. It registers a listener on the `message` event of the WhatsApp service singleton and pushes each incoming message onto a serial `AsyncQueue` (one message processed at a time).

### Processing flow

For each incoming message:

1. Own messages (`fromMe: true`) and group messages (`isGroup: true`) are silently skipped
2. The sender's phone number is extracted by stripping non-digit characters from the `from` JID
3. The `whatsapp_permissions` collection is queried for a matching `phoneNumber`; if not found or `canRead: false`, the message is skipped
4. The primary model (from `AppSettings.primaryModel`) is used to determine the LLM provider and API key
5. A dedicated chat session (title `"WhatsApp: <displayName>"`) is fetched or created in MongoDB; the `chatId` is stored on the permission record
6. The incoming message is saved to `messages` as a `role: 'user'` document with its original timestamp
7. The full `buildCombinedPrompt()` system instruction is used, extended with an extra `## WhatsApp Auto-Reply Context` paragraph naming the sender
8. `createAIToolCallbacks()` is called with `braveApiKey` only — image generation is excluded from auto-reply calls
9. The LLM is invoked non-streaming (the result is collected with `onChunk` and resolved in `onDone`)
10. The LLM response is saved to `messages` as a `role: 'assistant'` document
11. If `perm.canReply` is true and the response is non-empty, `whatsapp.sendMessage()` is called to send the reply

### Dedicated chat sessions

Each permitted contact gets exactly one dedicated chat session. The `chatId` is stored on the `WhatsAppPermission` document and reused on subsequent messages. If the chat document is later deleted, a new one is created automatically. The chat title follows the pattern `"WhatsApp: <displayName>"`.

The full conversation history is retained in MongoDB (up to the last 20 messages are loaded for LLM context on each call). This means the AI has conversational memory for each WhatsApp contact.

### Error handling

LLM errors are logged to stderr. If no text was accumulated before the error, the pre-inserted assistant message is deleted. If partial text was accumulated, it is saved. Processing errors in the queue are caught and logged without stopping the queue.

---

## Frontend (`packages/frontend/src/pages/ToolsPage.tsx`)

WhatsApp connection management has been merged into the **Tools page** (`/tools`), which also hosts the Brave Search configuration. There is no longer a standalone `/whatsapp` route.

### Connection flow

1. User clicks "Link Device" in the WhatsApp card
2. `POST /api/whatsapp/connect` is called
3. An SSE connection to `GET /api/whatsapp/qr/stream` is opened via `streamWhatsAppQR()`
4. The `qr` SSE event delivers the QR code as a base64 data URL, rendered as a 256×256 `<img>`
5. The user scans the QR with their phone (WhatsApp → Settings → Linked devices → Link a device)
6. The `connected` SSE event fires, the QR disappears, and the phone number is displayed
7. The SSE stream is closed client-side

### Status display

The page uses two data sources in priority order:

```typescript
const waStatus = streamStatus ?? waStatusData?.status ?? 'disconnected';
const waPhoneNumber = streamPhone ?? waStatusData?.phoneNumber ?? null;
```

`waStatusData` comes from a TanStack Query poll (`queryKey: ['whatsapp-status']`, `refetchInterval: 10_000`). `streamStatus` and `streamPhone` are local state updated by the SSE stream during active connection flows. The `AbortController` from `streamWhatsAppQR()` is stored in a `useRef` and aborted on component unmount and on successful connection.

### Permissions management

When connected, a "Manage Permissions" button opens `<WhatsAppPermissionsModal>`. This is a full-screen modal overlay that:

- Lists all current `WhatsAppPermission` records (queried via `api.whatsapp.permissions.list()`, cache key `['whatsapp-permissions']`)
- Allows adding new contacts (phone number + display name inputs; both `canRead` and `canReply` default to `false` on creation via the REST API)
- Exposes per-row toggle switches for `canRead` and `canReply` (each toggle calls `api.whatsapp.permissions.update(id, { canRead | canReply })`)
- Allows deleting a contact with a confirmation step

The component is at `packages/frontend/src/components/whatsapp/WhatsAppPermissionsModal.tsx`.

### Disconnect flow

Clicking "Disconnect" opens an inline confirmation dialog with an optional checkbox to clear the saved session (delete auth files). Confirming calls `POST /api/whatsapp/disconnect` with `{ clearSession: boolean }`.

### `streamWhatsAppQR` helper (`src/api/index.ts`)

The SSE stream is managed by the `streamWhatsAppQR()` function exported from the API module (not on the `api` object). It accepts five callbacks:

```typescript
streamWhatsAppQR({
  onQr:       (qr: string) => void,
  onStatus:   (status: string, phone: string | null) => void,
  onConnected: (phone: string | null) => void,
  onClose?:   () => void,
  onError?:   (err: Error) => void,
}): AbortController
```

Returns an `AbortController`. Call `controller.abort()` to close the stream. `onClose` fires when the stream ends naturally (e.g. backend restart). `onError` fires on connection failure.

---

## Data type reference

### `WhatsAppStatus`

```typescript
type WhatsAppStatus = 'disconnected' | 'connecting' | 'qr_ready' | 'connected';
```

### `BufferedMessage`

```typescript
interface BufferedMessage {
  id: string;               // Baileys message key ID
  from: string;             // sender JID (e.g. "14155551234@s.whatsapp.net")
  fromName: string | null;  // push name, or null
  to: string;               // recipient JID
  body: string;             // normalised text content
  timestamp: number;        // ms since epoch
  fromMe: boolean;          // sent by the linked account
  isGroup: boolean;         // from a group chat (@g.us JID)
}
```

### `WhatsAppPermission`

Stored in the `whatsapp_permissions` MongoDB collection. API responses use `id` instead of `_id`.

```typescript
interface WhatsAppPermission {
  _id: string;            // nanoid
  phoneNumber: string;    // digits only, unique index (e.g. "14155551234")
  displayName: string;    // human label (e.g. "Mom")
  contactId: string | null;  // optional link to contacts._id
  canRead: boolean;       // AI can read messages from this contact
  canReply: boolean;      // AI can auto-reply to this contact
  chatId: string | null;  // dedicated chat session ID (set lazily by auto-reply service)
  createdAt: Date;
  updatedAt: Date;
}
```

**Indexes**: `{ phoneNumber: 1 }` (unique), `{ contactId: 1 }`

---

## Limitations

- **In-memory buffer only**: Messages are held in RAM. The buffer holds a maximum of 100 messages and is cleared on every backend restart. The buffer is used for the `whatsapp_read_messages` AI tool. Auto-reply messages are persisted to MongoDB via dedicated chat sessions.
- **Text only for AI tools**: The `whatsapp_read_messages` tool returns text-normalised content. Binary media (images, audio, documents) are represented as `[Image]`, `[Audio message]`, etc. The AI cannot read or generate media attachments.
- **Single account**: Only one WhatsApp account can be linked at a time. This matches the single-user architecture of MetatronOS.
- **Outbound text only**: `whatsapp_send_message` and the auto-reply service send plain text messages only. Sending images, documents, or other media types is not currently supported.
- **Permission required for all AI access**: The AI cannot read from or send to any contact without an explicit `WhatsAppPermission` record. Contacts not in the `whatsapp_permissions` collection are invisible to the AI.
- **Auto-reply uses primary model only**: The auto-reply service always uses `AppSettings.primaryModel`. There is no per-contact model configuration.
- **Serial auto-reply queue**: Messages are processed one at a time. If the LLM call for one message is slow, subsequent messages queue behind it.

# Frontend Architecture

This document describes the structure, patterns, and conventions used in `packages/frontend`. It is written for developers extending the UI — not for end users.

## Technology stack

| Concern | Library | Version |
|---------|---------|---------|
| Rendering | React | 18.3 |
| Bundler | Vite | 6 |
| Routing | React Router | v6 |
| Server state | TanStack Query | v5 |
| UI state | Zustand | v5 |
| Styling | Tailwind CSS | v3 |
| Markdown | react-markdown + remark-gfm | 9 / 4 |
| Syntax highlight | react-syntax-highlighter (Prism) | 15 |
| Icons | Font Awesome (free-solid) | 6 |

## Route structure

All routes are nested under the `<Layout>` component, which renders `<SidePanel>` plus an `<Outlet>` for the active page.

```
/                      → redirect to /chat
/chat                  → ChatPage (no active chat; shows empty state)
/chat/:chatId          → ChatPage (loads and displays a specific chat)
/system-instruction    → SystemInstructionPage
/models                → ModelManagerPage
/tools                 → ToolsPage (Brave Search + WhatsApp connection + permissions)
/schedule              → SchedulePage (recurring AI task management)
/gallery               → GalleryPage
/settings              → SettingsPage
```

Routes are defined in `src/App.tsx`. The `<Layout>` route wrapper handles the media-query listener that drives the mobile/desktop sidebar behaviour.

## State management

Two Zustand stores handle all client-side state. Server state is managed entirely by TanStack Query.

### uiStore (`src/store/uiStore.ts`)

Owns layout state. The mobile breakpoint is 768px (aligned with Tailwind's `md:`).

| State | Initial value | Description |
|-------|-------------|-------------|
| `sidebarOpen` | `true` on desktop, `false` on mobile | Controls left sidebar visibility |
| `rightPanelOpen` | `false` | Controls the past-chats drawer |
| `isMobile` | derived from `window.innerWidth` | Set by the media-query listener in `Layout.tsx` |

Resizing from mobile to desktop automatically opens the sidebar via `setIsMobile`. Resizing from desktop to mobile does not force-close the sidebar (the user may have opened it intentionally), but the sidebar renders as an overlay drawer on mobile.

### chatStore (`src/store/chatStore.ts`)

Owns the SSE streaming buffer.

| State | Description |
|-------|-------------|
| `activeChatId` | ID of the currently displayed chat, or `null` |
| `isStreaming` | `true` while a stream is in progress |
| `streamingContent` | Accumulated text chunks during streaming; reset on `stopStreaming()` |
| `streamingMessageId` | Pre-assigned ID for the in-progress assistant message |

**Streaming lifecycle in ChatPage:**
1. User submits — `setStreaming({ isStreaming: true, streamingContent: '', streamingMessageId: null })` is called
2. `onStart` event — `streamingMessageId` is set; the temporary user message ID is replaced with the real one
3. `onChunk` events — `appendStreamChunk(text)` appends to `streamingContent`
4. `onDone` event — TanStack Query cache is invalidated for the chat and chat list; `stopStreaming()` resets the store

`ChatWindow` reads `isStreaming` and `streamingContent` directly from the store and renders a `<StreamingMessage>` below the persisted messages during the stream.

### TanStack Query

The `QueryClient` is created in `App.tsx` with `staleTime: 30_000` and `retry: 1` as defaults.

Cache keys in use:

| Query key | Data | Invalidated by |
|-----------|------|----------------|
| `['chats']` | `Chat[]` — full list | Create, delete, after stream `done` |
| `['chat', chatId]` | `Chat & { messages }` — single chat with history | After stream `done` |
| `['settings']` | `AppSettings` | Settings save mutations |
| `['system-instruction']` | `SystemInstruction` | Save and clear mutations in `SystemInstructionPage` |
| `['cronjobs']` | `CronJob[]` — all cronjobs | Create, update, delete, and toggle mutations in `SchedulePage` |
| `['whatsapp-status']` | `{ status, phoneNumber }` | After connect and disconnect in `ToolsPage`; also polled every 10 seconds |
| `['whatsapp-permissions']` | `WhatsAppPermission[]` | Create, update, and delete mutations in `WhatsAppPermissionsModal` |

## Component tree

```
App
└── QueryClientProvider
    └── BrowserRouter
        └── Routes
            └── Route (Layout)                     ← SidePanel + Outlet
                ├── Route (/)                      → Navigate /chat
                ├── Route (/chat)                  → ChatPage
                ├── Route (/chat/:id)              → ChatPage
                ├── Route (/system-instruction)    → SystemInstructionPage
                ├── Route (/models)                → ModelManagerPage
                ├── Route (/tools)                 → ToolsPage
                ├── Route (/schedule)              → SchedulePage
                ├── Route (/gallery)               → GalleryPage
                └── Route (/settings)              → SettingsPage
```

### Layout (`src/components/layout/Layout.tsx`)

Thin shell component. Sets up the media-query listener and renders the two-column layout: `<SidePanel>` on the left and `<main>` on the right. Uses `h-screen overflow-hidden` to prevent the page itself from scrolling — scroll containers are inside individual pages.

### SidePanel (`src/components/layout/SidePanel.tsx`)

Two modes depending on `isMobile`:

- **Desktop**: inline element, collapses from `w-56` to `w-16` (icon-only). Navigation labels disappear; icon `title` attributes provide tooltip accessibility.
- **Mobile**: `position: fixed`, slides in from the left. A translucent backdrop renders behind it; clicking the backdrop closes the panel.

The hamburger/X icon switches based on `sidebarOpen && isMobile`.

Nav items are defined as a static array at module scope. Each item uses React Router's `<NavLink>` which applies active styling automatically. Current nav items in order:

| Route | Icon | Label |
|-------|------|-------|
| `/chat` | `faComments` | Chat |
| `/gallery` | `faImages` | Gallery |
| `/models` | `faSlidersH` | Model Manager |
| `/tools` | `faToolbox` | Tools |
| `/schedule` | `faClock` | Schedule |
| `/system-instruction` | `faBrain` | Memory |

A Settings link (`faGear`, `/settings`) is rendered separately at the bottom of the nav area, above the footer. There is no longer a dedicated WhatsApp nav item — WhatsApp is accessible through the Tools page.

### ChatPage (`src/pages/ChatPage.tsx`)

The most complex page. Responsibilities:

- Reads `chatId` from the URL; if absent, the page renders in "new chat" mode
- Loads the chat and its messages via `useQuery(['chat', chatId])`
- Manages local `provider` and `model` state; syncs defaults from settings on first load
- Handles the full send flow: creates a chat if needed, optimistically inserts the user message, calls `streamMessage()`, and manages streaming state
- Renders `<ModelSelector>` (top bar), `<ChatWindow>` or empty state, `<ChatInput>`, and `<RightPanel>`

**Optimistic update pattern**: a temporary user message with a `temp-user-{timestamp}` ID is added to `localMessages` immediately on send. When the `start` SSE event arrives with the real `userMessageId`, the temp ID is replaced in-place. After the `done` event, the query cache is invalidated and the component re-fetches clean data from the server.

### ChatWindow / ChatMessage / StreamingMessage

`ChatWindow` renders the scrollable message list. It holds a `bottomRef` div at the end of the list and calls `scrollIntoView({ behavior: 'smooth' })` whenever `messages` or `streamingContent` changes.

`ChatMessage` renders differently for `role: 'user'` and `role: 'assistant'`:

- **User**: plain text in a gray pill bubble, right-aligned. Copy button and timestamp appear on hover (`group-hover:opacity-100`).
- **Assistant**: `<ReactMarkdown>` with GFM and custom renderers. Fenced code blocks (`language-xxx`) use Prism `oneLight` theme. Inline code uses a gray background span. Links open in a new tab with `rel="noopener noreferrer"`.

`StreamingMessage` renders while `isStreaming` is true. If `streamingContent` is non-empty it renders a live `<ReactMarkdown>`. If empty (before the first chunk), it renders a three-dot bounce animation.

### ChatInput (`src/components/chat/ChatInput.tsx`)

Auto-growing textarea clamped between `MIN_ROWS=3` and `MAX_ROWS=9`. Height is calculated in pixels using a hard-coded `LINE_HEIGHT=24`. The textarea grows by resetting `height: auto` and then measuring `scrollHeight`.

Submit triggers on Enter (without Shift). Shift+Enter inserts a newline. The send button fades in/out using `opacity` and `scale` transitions based on whether there is sendable text.

The attach button (+) is present in the UI but is currently a no-op placeholder for future file attachment functionality.

### ModelSelector (`src/components/chat/ModelSelector.tsx`)

Dropdown rendered as a custom `<ul role="listbox">`. Closes when the user clicks outside (mousedown listener on `document`, cleaned up on close). Groups models by provider (Google / OpenAI). The active selection is highlighted with `bg-black text-white`.

### RightPanel (`src/components/chat/RightPanel.tsx`)

Slides in from the right (`translate-x-full` → `translate-x-0`). Lists all chats from the `['chats']` query. Allows creating a new chat with the currently selected provider/model, navigating to an existing chat, and deleting a chat. Closes on outside click.

### SystemInstructionPage (`src/pages/SystemInstructionPage.tsx`)

Presents three sections, each in a `<Section>` card:

1. **Core Instruction** — a resizable monospace textarea for the user to author the AI's identity prompt. Saved independently with a `PUT /api/system-instruction` call carrying only `{ coreInstruction }`.

2. **Dynamic Memory** — a toggle switch for `memoryEnabled` (saved immediately on toggle) and a resizable monospace textarea showing the AI's current memory. The user can manually edit and save the memory or clear it entirely (`DELETE /api/system-instruction/memory`). A character counter shows progress toward the 4,000-character limit. The `lastUpdated` timestamp from the server is displayed below this section.

3. **Database Schema** — a read-only monospace textarea showing the AI's self-maintained table documentation. The user can clear it (`DELETE /api/system-instruction/db-schema`) but cannot edit it — the AI manages this content through the `update_db_schema` tool.

Each save operation uses a shared `saveMutation` (`useMutation`). A `savedSection` state string tracks which section's save button should show the "Saved" confirmation icon (auto-cleared after 2 seconds).

### ModelManagerPage (`src/pages/ModelManagerPage.tsx`)

Settings form for both providers. API keys are typed into local state (`geminiKey`, `openaiKey`) and submitted per-provider — they are never pre-populated from the server (the server returns masked values). Clearing the input and saving sends `apiKey: ""` which replaces the stored key.

`hasApiKey` from the settings response is used only to display the "Key stored securely" badge — not to control form state.

### SchedulePage (`src/pages/SchedulePage.tsx`)

Full CRUD page for managing recurring AI tasks (cronjobs). Lists all cronjobs as cards, each showing the name, a human-readable cron description (via a `cronToHuman()` utility), the raw cron expression, an enable/disable toggle switch, the last run timestamp, and action buttons (View Chat, Edit, Delete).

- **Add/Edit modal** — shared form for creating and editing cronjobs. Includes name, instruction (textarea), cron expression (with live human-readable preview), and preset buttons for common schedules (daily 9 PM, daily 9 AM, weekdays 9 AM, every hour, Monday 9 AM).
- **Delete confirmation** — inline dialog before deleting a cronjob and its dedicated chat.
- **View Chat** — navigates to `/chat/{chatId}` to see execution results.
- TanStack Query cache key: `['cronjobs']`.

### ToolsPage (`src/pages/ToolsPage.tsx`)

Hosts configuration for external integrations. Currently contains two cards: Brave Search and WhatsApp.

**Brave Search card** — toggle switch enables/disables the tool. When no key is stored, toggling opens a modal for key entry. When a key is stored, edit and remove actions are available. The modal calls `PUT /api/settings` with `{ tools: { braveSearch: { enabled, apiKey } } }`.

**WhatsApp card** — manages the WhatsApp Web connection lifecycle. Displays the connection status badge, QR code (when scanning is required), linked phone number (when connected), and disconnect/permissions controls. The page uses two data sources in priority order:

1. **SSE stream** (`streamWhatsAppQR`) — real-time updates during an active connect flow; sets `streamStatus` and `streamPhone` local state
2. **TanStack Query poll** (`queryKey: ['whatsapp-status']`, `refetchInterval: 10_000`) — background polling

The effective `status` is `streamStatus ?? waStatusData?.status ?? 'disconnected'`.

During a connect flow, after `POST /api/whatsapp/connect` returns, the SSE stream is opened. The QR image (256×256 `<img>`) is shown when `status === 'qr_ready'`. When the `connected` event fires, the stream is closed and the phone number is displayed.

When connected, a "Manage Permissions" button opens `<WhatsAppPermissionsModal>`.

Disconnecting opens an inline confirmation dialog with an optional "Clear saved session" checkbox, which calls `POST /api/whatsapp/disconnect`.

The SSE `AbortController` is stored in a `useRef` and is aborted on unmount and on successful connection.

### WhatsAppPermissionsModal (`src/components/whatsapp/WhatsAppPermissionsModal.tsx`)

Full-screen overlay modal opened from `ToolsPage` when WhatsApp is connected. Manages the `whatsapp_permissions` collection via the `api.whatsapp.permissions` methods. TanStack Query cache key: `['whatsapp-permissions']`.

- Renders a scrollable list of all permission records, each showing `displayName`, `phoneNumber`, and toggle switches for `canRead` and `canReply`
- Provides an inline add form (phone + display name inputs); new records are created with both flags defaulting to `false`
- Each toggle switch calls `api.whatsapp.permissions.update(id, { canRead | canReply })` immediately on click
- Deleting a record requires a confirmation step within the modal

### SettingsPage (`src/pages/SettingsPage.tsx`)

Two configuration cards:

**Timezone card** — searchable dropdown of all IANA timezones with computed UTC offsets. The user's detected timezone is listed first. Saves via `PUT /api/settings` with `{ timezone }`.

**Pulse card** — configures the autonomous heartbeat system:
- **Enable/disable toggle** — simple on/off switch
- **Pulse interval selector** — five preset buttons: every 30 min (48/day), hourly (24/day), every 2 hours (12/day, recommended), every 4 hours (6/day), every 12 hours (2/day)
- **Weekday selector** — seven circular day buttons (S M T W T F S); black when active, gray when inactive
- **Quiet hours** — time input pairs (start→end) with add/remove; default: 23:00→07:00
- **Status info** (read-only) — last pulse time, pulses today count
- **View Pulse Chat button** — navigates to `/chat/{chatId}` if a pulse chat exists

Saves via `PUT /api/settings` with `{ pulse: { ... } }`. Uses a separate `useMutation` from the timezone save so each section operates independently.

## API client (`src/api/index.ts`)

A thin `request<T>()` wrapper over `fetch`. All requests use `Content-Type: application/json` and throw an `Error` with the server's `error` field if the response is not `2xx`.

The `api` object exposes typed methods for chats, settings, and system instruction:

```typescript
api.chats.list()                             // GET /api/chats
api.chats.get(id)                            // GET /api/chats/:id
api.chats.create({ provider, model, title }) // POST /api/chats
api.chats.patch(id, { title })               // PATCH /api/chats/:id
api.chats.delete(id)                         // DELETE /api/chats/:id
api.settings.get()                           // GET /api/settings
api.settings.update(partial)                 // PUT /api/settings
api.systemInstruction.get()                  // GET /api/system-instruction
api.systemInstruction.update(partial)        // PUT /api/system-instruction
api.systemInstruction.clearMemory()          // DELETE /api/system-instruction/memory
api.systemInstruction.clearDbSchema()        // DELETE /api/system-instruction/db-schema
api.whatsapp.status()                        // GET /api/whatsapp/status
api.whatsapp.connect()                       // POST /api/whatsapp/connect
api.whatsapp.disconnect(clearSession)        // POST /api/whatsapp/disconnect
api.whatsapp.messages(contact?, limit?)      // GET /api/whatsapp/messages
api.whatsapp.permissions.list()              // GET /api/whatsapp/permissions
api.whatsapp.permissions.create(data)        // POST /api/whatsapp/permissions
api.whatsapp.permissions.update(id, data)    // PATCH /api/whatsapp/permissions/:id
api.whatsapp.permissions.delete(id)          // DELETE /api/whatsapp/permissions/:id
api.cronjobs.list()                          // GET /api/cronjobs
api.cronjobs.create(data)                    // POST /api/cronjobs
api.cronjobs.update(id, data)                // PATCH /api/cronjobs/:id
api.cronjobs.delete(id)                      // DELETE /api/cronjobs/:id
api.cronjobs.toggle(id)                      // POST /api/cronjobs/:id/toggle
```

`clearMemory()` and `clearDbSchema()` use raw `fetch` rather than the `request<T>()` helper because they return `204 No Content` (no JSON body to parse).

`streamMessage(chatId, content, callbacks)` is exported separately (not on the `api` object) because it does not use the `request()` helper — it uses the streaming Fetch API directly. It returns an `AbortController`.

`streamWhatsAppQR(callbacks)` is also exported separately. It opens the `GET /api/whatsapp/qr/stream` SSE connection and dispatches `onQr`, `onStatus`, `onConnected`, `onClose`, and `onError` callbacks. It returns an `AbortController`. See `DOCS/whatsapp.md` for the full callback signatures.

## Type definitions (`src/types/index.ts`)

Frontend-only types. These are **not** imported from the backend package — they are maintained in parallel with the MongoDB document interfaces in `packages/backend/src/db/schema.ts`. If the database schema changes, this file must be updated to match.

Interfaces defined here:
- `Chat` — chat session metadata
- `Message` — a single chat message
- `GeminiSettings` / `OpenAISettings` / `AppSettings` — provider settings shapes
- `SystemInstruction` — the AI instruction/memory/schema config (mirrors `src/services/systemInstruction.ts`)
- `CronJob` — recurring task with cron expression, dedicated chat, and scheduling metadata
- `QuietHoursRange` — `{ start: string, end: string }` in "HH:mm" format
- `PulseInterval` — `48 | 24 | 12 | 6 | 2` union type
- `PulseSettings` — pulse heartbeat configuration (enabled, activeDays, pulsesPerDay, quietHours, chatId, notes, tracking fields)
- `Provider` — `'gemini' | 'openai'` union type alias

The model lists (`GEMINI_MODELS`, `OPENAI_MODELS`, `GEMINI_IMAGE_MODELS`, `OPENAI_IMAGE_MODELS`) are defined here as `const` arrays with `{ id, label }` objects. These arrays are the source of truth for what models the UI knows about. Adding a new model requires editing this file and rebuilding — there is no dynamic model discovery from the API.

## Internationalisation (`src/i18n/`)

All UI strings are defined in `src/i18n/en-US.ts` and exported as a deeply nested `const` object. The `t` export from `src/i18n/index.ts` is the active locale's string map.

To add a string: add it to `en-US.ts` under the appropriate key, then reference it as `t.section.key` in components. The TypeScript type `Strings` (inferred from the const object) ensures all references are valid at compile time.

To add a new locale:
1. Create `src/i18n/<locale>.ts` matching the `Strings` type
2. Add it to the `locales` object in `src/i18n/index.ts`
3. Set `ACTIVE_LOCALE` to the new locale key

The `dir` export (`'ltr'` or `'rtl'`) is intended to be set on the `<html>` element — it is not currently applied in `main.tsx` but the infrastructure is in place.

## Styling conventions

- Tailwind utility classes only — no custom CSS except for animations defined in `tailwind.config.ts` and global resets in `src/styles/globals.css`
- Custom animations: `animate-fade-in` (opacity + translateY, 150ms), `animate-slide-in` (translateX, 200ms)
- Border radius on interactive elements: `rounded-full` for buttons and inputs, `rounded-2xl` for cards/panels
- Active state feedback: `active:scale-95` or `active:scale-[0.97]` on all clickable elements
- Color palette: near-monochrome. Primary action = `bg-black text-white`; hover = `bg-gray-100`; borders = `border-gray-100` or `border-gray-200`

### Global CSS (`src/styles/globals.css`)

Three `@layer base` rules apply globally:
- `box-sizing: border-box` on all elements
- `-webkit-tap-highlight-color: transparent` on `html` (removes mobile tap flash)
- `font-sans antialiased text-black bg-white` on `body`

A `@layer utilities` block defines `.prose` helper classes for markdown rendering. These are used by the `prose prose-sm` classes on assistant message containers. The classes style paragraphs, lists, headings, tables, and horizontal rules. They complement Tailwind's built-in utilities rather than using the `@tailwindcss/typography` plugin (which is not installed).

A thin custom scrollbar (`width: 4px`) is applied via `::-webkit-scrollbar` — visible in Chromium-based browsers and Safari.

## TypeScript configuration

`packages/frontend/tsconfig.json` extends the base config with:

- `target: ES2020`, `lib: ["ES2020", "DOM", "DOM.Iterable"]` — browser environment
- `jsx: react-jsx` — uses the automatic JSX transform (no `import React` needed in every file)
- `moduleResolution: bundler` — Vite's bundler handles resolution; no `.js` extension required on imports
- `noEmit: true` — TypeScript is used only for type-checking; Vite performs the actual transpilation
- `baseUrl: "."` + `paths: { "@/*": ["src/*"] }` — enables the `@/` import alias for the language server

## Build output chunking

`vite.config.ts` splits the bundle into named chunks to optimise cache lifetime:

| Chunk | Contents |
|-------|----------|
| `vendor-react` | react, react-dom, react-router-dom |
| `vendor-query` | @tanstack/react-query |
| `vendor-markdown` | react-markdown, remark-gfm, react-syntax-highlighter |
| `vendor-fontawesome` | fontawesome core + icons + react adapter |

These vendor chunks change infrequently and will be served from browser cache across deployments. App code (`index-*.js`) will change on every deploy.

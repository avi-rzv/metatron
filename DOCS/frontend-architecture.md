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
                └── Route (/models)                → ModelManagerPage
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
| `/system-instruction` | `faBrain` | System Instruction |
| `/models` | `faSlidersH` | Model Manager |

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
```

`clearMemory()` and `clearDbSchema()` use raw `fetch` rather than the `request<T>()` helper because they return `204 No Content` (no JSON body to parse).

`streamMessage(chatId, content, callbacks)` is exported separately (not on the `api` object) because it does not use the `request()` helper — it uses the streaming Fetch API directly. It returns an `AbortController`.

## Type definitions (`src/types/index.ts`)

Frontend-only types. These are **not** imported from the backend package — they are maintained in parallel with the Drizzle schema. If the database schema changes, this file must be updated to match.

Interfaces defined here:
- `Chat` — chat session metadata
- `Message` — a single chat message
- `GeminiSettings` / `OpenAISettings` / `AppSettings` — provider settings shapes
- `SystemInstruction` — the AI instruction/memory/schema config (mirrors `src/services/systemInstruction.ts`)
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

# Developer Setup Guide

This guide gets a developer running MetatronOS locally. The target environment is Node.js 20 LTS on any OS. Production runs inside Docker on a Linux VPS; local development does not require Docker.

## Prerequisites

- Node.js 20 LTS (`node --version` should print `v20.x.x`)
- npm 10+ (ships with Node 20)
- Git

No database daemon, no Redis, no Docker required for local development.

## Repository layout

```
metatron/                        ← npm workspace root
├── package.json                 ← workspace config, root dev/build/start scripts
├── tsconfig.base.json           ← shared TS compiler options (extended by packages)
├── .env.example                 ← template for the backend .env file
├── packages/
│   ├── backend/                 ← Fastify API server (Node.js, ESM)
│   │   ├── src/
│   │   │   ├── index.ts         ← server entry point
│   │   │   ├── db/
│   │   │   │   ├── schema.ts    ← Drizzle schema + inferred TypeScript types
│   │   │   │   └── index.ts     ← DB connection, WAL pragma, bootstrap DDL
│   │   │   ├── routes/
│   │   │   │   ├── chats.ts              ← CRUD + SSE streaming endpoint
│   │   │   │   ├── settings.ts           ← GET/PUT /api/settings
│   │   │   │   └── systemInstruction.ts  ← GET/PUT/DELETE /api/system-instruction
│   │   │   └── services/
│   │   │       ├── encryption.ts         ← AES-256-GCM helpers
│   │   │       ├── settings.ts           ← AppSettings read/write/decrypt
│   │   │       ├── systemInstruction.ts  ← system prompt + memory + db schema
│   │   │       ├── aiTools.ts            ← save_memory / db_query / update_db_schema callbacks
│   │   │       ├── sqlValidator.ts       ← blocks protected tables from AI SQL
│   │   │       └── llm/
│   │   │           ├── gemini.ts         ← @google/genai streaming + function-calling
│   │   │           └── openai.ts         ← openai streaming + runTools
│   │   ├── drizzle.config.ts    ← drizzle-kit config (schema path, dialect, db url)
│   │   ├── tsconfig.json        ← extends tsconfig.base; NodeNext module resolution
│   │   └── package.json
│   └── frontend/                ← React 18 SPA (Vite, Tailwind)
│       ├── src/
│       │   ├── main.tsx         ← ReactDOM.createRoot entry
│       │   ├── App.tsx          ← QueryClientProvider, BrowserRouter, route tree
│       │   ├── api/index.ts     ← REST helpers + streamMessage() SSE client
│       │   ├── store/
│       │   │   ├── uiStore.ts   ← sidebar/panel open state, mobile breakpoint
│       │   │   └── chatStore.ts ← activeChatId, SSE streaming buffer
│       │   ├── types/index.ts   ← Chat, Message, AppSettings interfaces + model lists
│       │   ├── i18n/
│       │   │   ├── en-US.ts     ← all UI strings (English)
│       │   │   └── index.ts     ← active locale export (t, dir, locale)
│       │   ├── components/
│       │   │   ├── layout/      ← Layout.tsx, SidePanel.tsx
│       │   │   └── chat/        ← ChatWindow, ChatMessage, ChatInput, ModelSelector, RightPanel
│       │   ├── pages/
│       │   │   ├── ChatPage.tsx              ← main chat UI with SSE integration
│       │   │   ├── SystemInstructionPage.tsx ← AI identity / memory / db schema editor
│       │   │   └── ModelManagerPage.tsx      ← API key + model/thinking/image pickers
│       │   └── styles/globals.css
│       ├── vite.config.ts       ← dev proxy /api → :4000, chunking strategy
│       ├── tailwind.config.ts   ← custom fonts, animations (fade-in, slide-in)
│       └── package.json
└── DOCS/                        ← this directory
```

## First-time setup

```bash
# 1. Clone and install all workspaces at once
git clone <repo-url> metatron
cd metatron
npm install          # installs root + both packages via workspaces

# 2. Create the backend environment file
cp .env.example packages/backend/.env
#    Edit packages/backend/.env and set ENCRYPTION_SECRET to a long random string.
#    Every other variable has a sensible default for local dev.
```

The `.env` file lives inside `packages/backend/` — the backend reads it via `process.env`. The frontend has no `.env` file; all runtime configuration comes through the API.

## Running in development

```bash
npm run dev          # from repo root
```

This runs `concurrently` with two processes:

| Process | Command | Port | Hot reload |
|---------|---------|------|------------|
| Backend | `tsx watch src/index.ts` | 4000 | Yes (tsx watch) |
| Frontend | `vite` | 3000 | Yes (Vite HMR) |

The Vite dev server proxies `/api/*` to `http://localhost:4000` and `/ws/*` to `ws://localhost:4000`, so the frontend always uses relative URLs (`/api/...`) — no CORS issues in dev.

Open `http://localhost:3000` in a browser.

## Environment variables

All variables are backend-only. Set them in `packages/backend/.env`.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `4000` | Fastify listen port |
| `HOST` | `0.0.0.0` | Fastify bind address |
| `DATABASE_URL` | `./data/metatron.db` | Path to the SQLite file, resolved relative to the backend working directory |
| `ENCRYPTION_SECRET` | `metatron-dev-secret-change-in-production` | Passphrase used by scrypt to derive the AES-256-GCM key. **Change this before storing any real API keys.** |
| `FRONTEND_ORIGIN` | `http://localhost:3000` | Allowed CORS origin — must exactly match the browser origin in production |
| `NODE_ENV` | `development` | Controls Fastify logger format: `development` uses pretty-print; anything else uses JSON |

## Database

The database is created automatically when the backend starts. There are no migration files to run on first boot — the backend executes bootstrap DDL (`CREATE TABLE IF NOT EXISTS`) on every startup via `src/db/index.ts`.

The SQLite file is written to the path in `DATABASE_URL`. The parent directory is created automatically if it does not exist.

**Drizzle-kit commands** (run from `packages/backend/`):

```bash
npm run db:generate   # generates SQL migration files into packages/backend/drizzle/
npm run db:migrate    # applies pending migrations
npm run db:push       # pushes schema directly to the DB without migration files (dev shortcut)
```

The `db:push` shortcut is convenient during local schema iteration. Use `db:generate` + `db:migrate` for production deployments.

## Building for production

```bash
npm run build        # from repo root
```

This runs sequentially:
1. `vite build` + `tsc` in the frontend — outputs static assets to `packages/frontend/dist/`
2. `tsc` in the backend — compiles to `packages/backend/dist/`

In production, the Fastify server is expected to serve the frontend's `dist/` directory as static files via `@fastify/static` (the package is declared as a dependency). This is not yet wired in `src/index.ts` — see the TODO note in the API reference.

To start the compiled backend:

```bash
npm run start        # runs `node packages/backend/dist/index.js`
```

## TypeScript configuration

The workspace uses two levels of TypeScript config:

- `tsconfig.base.json` (root) — shared settings: `target: ES2022`, `strict: true`, `sourceMap: true`, `declarationMap: true`. Uses `moduleResolution: bundler` as base.
- `packages/backend/tsconfig.json` — extends base, overrides to `module: NodeNext` and `moduleResolution: NodeNext` (required for native ESM Node.js). Imports inside the backend must use explicit `.js` extensions on relative imports (e.g., `import { db } from '../db/index.js'`).
- `packages/frontend/tsconfig.json` — extends base, uses Vite's bundler resolution. The `@` alias resolves to `packages/frontend/src/`.

## Adding a new backend route

1. Create `packages/backend/src/routes/your-route.ts` that exports an `async function yourRoutes(fastify: FastifyInstance)`.
2. Register it in `packages/backend/src/index.ts` with `await fastify.register(yourRoutes)`.
3. Use Drizzle query helpers (`db.select().from(table).all()` etc.) — the `db` instance is exported from `src/db/index.ts`.

## Adding a new frontend page

1. Create `packages/frontend/src/pages/YourPage.tsx`.
2. Add the route in `App.tsx` inside the `<Route element={<Layout />}>` block.
3. Add a nav entry to the `navItems` array in `components/layout/SidePanel.tsx` if it should appear in the sidebar.
4. Add any new UI strings to `src/i18n/en-US.ts` and reference them via the `t` export from `src/i18n`.

## Path alias

The frontend uses `@` as an alias for `src/`. This is configured in both `vite.config.ts` (for the bundler) and `packages/frontend/tsconfig.json` (for the TypeScript language server). Always use `@/` for imports within the frontend — never use relative `../../` paths that cross more than one directory level.

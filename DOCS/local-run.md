# Running MetatronOS Locally (Windows)

This guide covers running MetatronOS on a **Windows** development machine. The production server runs Ubuntu 24.04 LTS — local development skips Docker, Nginx, and PM2 entirely. You just run two processes: a Fastify backend and a Vite frontend dev server.

---

## Prerequisites

### 1. Node.js 20 LTS

MetatronOS requires **Node.js 20 LTS**. Download and run the installer from the [official Node.js site](https://nodejs.org/) — choose the **LTS** release (20.x.x).

After installing, verify in a terminal (PowerShell or Git Bash):

```bash
node --version   # v20.x.x
npm --version    # 10.x.x
```

### 2. Git

Download Git for Windows from [git-scm.com](https://git-scm.com/). Accept the defaults during setup. Git Bash (included) is the recommended terminal for this project.

### 3. MongoDB

MetatronOS uses MongoDB as its database. Install MongoDB Community Edition locally:

1. Download the [MongoDB Community Server MSI](https://www.mongodb.com/try/download/community) for Windows
2. Run the installer — choose **"Complete"** setup
3. Leave **"Install MongoDB as a Service"** checked (recommended)
4. Click **Install**

After installation, MongoDB runs automatically as a Windows service on `localhost:27017`.

Verify it is running by opening a terminal and running:

```bash
mongosh --eval "db.runCommand({ ping: 1 })"
```

You should see `{ ok: 1 }`.

### 4. Windows Build Tools (required for native addons)

The project uses `node-pty`, a native Node.js addon that must be compiled from C++ source during `npm install`. Without the build tools, the install will fail with a `node-gyp` error.

**Install Visual Studio Build Tools (free):**

1. Download [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
2. Run the installer
3. Select **"Desktop development with C++"** workload
4. Click **Install**

This takes several minutes. When done, close the installer.

> **Alternative (automated):** You can install the build tools via npm as a one-time global step. Open PowerShell **as Administrator** and run:
> ```powershell
> npm install --global windows-build-tools
> ```
> This works but may be slower than the Visual Studio installer for some machines.

---

## Step 1 — Clone the Repository

Open Git Bash (or PowerShell) and clone the repo:

```bash
git clone git@github.com:avi-rzv/metatron.git
cd metatron
```

If you haven't set up an SSH key for GitHub yet, clone via HTTPS instead:

```bash
git clone https://github.com/avi-rzv/metatron.git
cd metatron
```

---

## Step 2 — Install Dependencies

From the repository root, install all workspace dependencies at once:

```bash
npm install
```

This installs packages for both `packages/backend` and `packages/frontend` via npm workspaces. The `node-pty` native addon will be compiled here using the build tools from the prerequisite step. Compilation may take 30–60 seconds.

**If you see a `node-gyp` error**, the build tools are not installed or not found. Re-read the prerequisites section and ensure Visual Studio Build Tools are installed with the "Desktop development with C++" workload selected.

---

## Step 3 — Create the Environment File

The backend reads configuration from a `.env` file. A template is provided in the repo root:

```bash
cp .env.example packages/backend/.env
```

On Windows with PowerShell (if you're not using Git Bash):

```powershell
Copy-Item .env.example packages/backend/.env
```

Open `packages/backend/.env` in any text editor. The defaults work for local development out of the box:

```env
PORT=4000
HOST=0.0.0.0
MONGODB_URI=mongodb://127.0.0.1:27017
MONGODB_DB=metatron
ENCRYPTION_SECRET=change-this-to-a-long-random-string-in-production
FRONTEND_ORIGIN=http://localhost:3000
NODE_ENV=development
```

You only need to change `ENCRYPTION_SECRET` if you plan to store real API keys locally. To generate a secure value:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Copy the output and set it as the value of `ENCRYPTION_SECRET`.

> The `.env` file is git-ignored and will never be committed. Do not rename or move it — the backend only looks for it at `packages/backend/.env`.

---

## Step 4 — Start the Development Servers

From the repository root, run:

```bash
npm run dev
```

This uses `concurrently` to start two processes simultaneously:

| Process | Command | URL | Hot reload |
|---------|---------|-----|------------|
| Backend (Fastify) | `tsx watch src/index.ts` | `http://localhost:4000` | Yes — restarts on file save |
| Frontend (Vite) | `vite` | `http://localhost:3000` | Yes — HMR, no page reload |

Both processes output to the same terminal with color-coded prefixes so you can tell them apart.

**Wait until you see both of these messages before opening the browser:**

- Backend: `Server listening at http://0.0.0.0:4000`
- Frontend: `Local: http://localhost:3000/`

---

## Step 5 — Open the App

Open your browser and navigate to:

```
http://localhost:3000
```

> **Why port 3000 and not 4000?**
> The Vite dev server runs on port 3000 and serves the React frontend. It automatically proxies any requests to `/api/*` and `/ws/*` through to the backend on port 4000. You never need to open port 4000 directly in the browser.

---

## Database

MongoDB collections and indexes are created automatically on first backend startup. No migration commands are needed for a fresh local setup — the backend creates indexes via `createIndex()` on every start (idempotent).

Make sure MongoDB is running before starting the backend. If you installed it as a Windows service (recommended), it starts automatically.

**If migrating from an older SQLite-based installation**, run the one-time migration script:

```bash
cd packages/backend
npm run migrate:sqlite-to-mongo
```

This reads data from the old `data/metatron.db` SQLite file and inserts it into MongoDB. Safe to run multiple times.

---

## Stopping the Servers

Press `Ctrl+C` in the terminal running `npm run dev`. Both the backend and frontend processes will be terminated together.

---

## Differences From Production

| | Local (Windows) | Production (Ubuntu VPS) |
|---|---|---|
| **Frontend** | Vite dev server on port 3000 | Static files served by Fastify |
| **API proxy** | Vite proxies `/api` → 4000 | Nginx proxies HTTPS → 4000 |
| **Process manager** | Manual terminal (`npm run dev`) | PM2 |
| **HTTPS** | No (plain HTTP) | Yes (Nginx + Let's Encrypt) |
| **Docker** | Not used | Single container |
| **Logs** | Terminal output (pretty-printed) | PM2 logs (JSON format) |
| **NODE_ENV** | `development` | `production` |

---

## Troubleshooting

### `npm install` fails with `node-gyp` / `MSBUILD` error

The C++ build tools are missing or not detected. Fix:

1. Install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the **"Desktop development with C++"** workload
2. Restart your terminal (environment variables need to be refreshed)
3. Run `npm install` again

### Backend fails to start — MongoDB connection error

MongoDB is not running. Check its status:

```bash
# Windows — check if the MongoDB service is running
sc query MongoDB

# If not running, start it
net start MongoDB
```

If MongoDB was not installed as a service, start it manually:
```bash
mongod --dbpath "C:\data\db"
```

### Backend fails to start — `ENCRYPTION_SECRET` error

The `.env` file is missing or in the wrong location. Make sure it exists at `packages/backend/.env` (not the repo root).

### Port 3000 or 4000 already in use

Another process is using that port. Find and stop it:

```bash
# Find what's using port 3000
netstat -ano | findstr :3000

# Kill the process (replace <PID> with the number from above)
taskkill /PID <PID> /F
```

Repeat for port 4000 if needed.

### Frontend shows a blank page or network errors

The backend is likely not running. Check the terminal output — look for the Fastify startup line. If the backend crashed, the error will be printed there.

### Changes to the backend are not reflected

`tsx watch` restarts the backend automatically on file save. If a restart loop or crash occurs, check the terminal for the error, fix the code, and it will restart again.

### `git clone` via SSH fails

Set up an SSH key and add it to your GitHub account:

```bash
ssh-keygen -t ed25519 -C "your-email@example.com"
cat ~/.ssh/id_ed25519.pub   # copy this and add it to GitHub → Settings → SSH Keys
```

Or use the HTTPS clone URL instead.

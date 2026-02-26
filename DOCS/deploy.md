# MetatronOS — Deployment Guide

**Server:** Hostinger VPS · Ubuntu 24.04 LTS · IP `76.13.147.50`
**GitHub:** `https://github.com/avi-rzv/metatron`

---

## Table of Contents

1. [First Install — Fresh VPS Setup](#1-first-install--fresh-vps-setup)
2. [Deploying Updates](#2-deploying-updates)

---

## 1. First Install — Fresh VPS Setup

### Step 1 — Connect to the VPS

From your local machine, open a terminal and SSH into the server:

```bash
ssh root@76.13.147.50
```

If you have an SSH key configured, it will use that automatically. Otherwise you will be prompted for the root password.

---

### Step 2 — Update the System

Always start with a full system update on a fresh VPS:

```bash
apt update && apt upgrade -y
```

---

### Step 3 — Install Required System Packages

MetatronOS requires build tools for native Node.js addons (`node-pty`) and MongoDB as the database. Install all system packages upfront:

```bash
apt install -y \
  git \
  curl \
  wget \
  build-essential \
  python3 \
  python3-pip \
  pkg-config \
  gnupg \
  nginx \
  ufw
```

**What each package is for:**

| Package | Purpose |
|---------|---------|
| `git` | Clone the repo and pull updates |
| `curl` / `wget` | Download installers |
| `build-essential` | C/C++ compiler (`gcc`, `g++`, `make`) — required to compile `node-pty` native binaries |
| `python3` | Required by `node-gyp` (native addon build tool) |
| `pkg-config` | Helps `node-gyp` locate system libraries |
| `gnupg` | Required for adding the MongoDB APT repository key |
| `nginx` | Reverse proxy — forwards HTTPS traffic to the Node.js backend |
| `ufw` | Firewall to restrict open ports |

---

### Step 4 — Install MongoDB

Install MongoDB Community Edition 8.0 from the official repository:

```bash
curl -fsSL https://www.mongodb.org/static/pgp/server-8.0.asc | \
  gpg --dearmor -o /usr/share/keyrings/mongodb-server-8.0.gpg

echo "deb [ signed-by=/usr/share/keyrings/mongodb-server-8.0.gpg ] https://repo.mongodb.org/apt/ubuntu noble/mongodb-org/8.0 multiverse" | \
  tee /etc/apt/sources.list.d/mongodb-org-8.0.list

apt update
apt install -y mongodb-org
```

Start MongoDB and enable it to start on boot:

```bash
systemctl start mongod
systemctl enable mongod
```

Verify it is running:

```bash
mongosh --eval "db.runCommand({ ping: 1 })"
```

You should see `{ ok: 1 }`.

MongoDB stores data at `/var/lib/mongodb` by default. No additional configuration is needed — MetatronOS connects to `mongodb://127.0.0.1:27017` out of the box.

---

### Step 5 — Install Node.js 20 LTS

The project requires **Node.js 20 LTS**. Use the official NodeSource setup script:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
```

Verify the installation:

```bash
node --version   # should print v20.x.x
npm --version    # should print 10.x.x or similar
```

---

### Step 6 — Install PM2 (Process Manager)

PM2 keeps the Node.js backend running in the background, restarts it on crashes, and auto-starts it on server reboots:

```bash
npm install -g pm2
```

---

### Step 7 — Configure the Firewall

Allow only the ports we actually need:

```bash
ufw allow OpenSSH        # SSH — keep this or you will lock yourself out
ufw allow 80             # HTTP — needed for Certbot SSL verification
ufw allow 443            # HTTPS — production traffic
ufw enable
```

Verify the rules:

```bash
ufw status
```

---

### Step 8 — Create a Dedicated App User (Recommended)

Running the app as root is a security risk. Create a non-root user:

```bash
adduser metatron
usermod -aG sudo metatron
```

Switch to that user for all remaining steps:

```bash
su - metatron
```

---

### Step 9 — Set Up SSH Key for GitHub Access

This allows the server to pull from the private GitHub repo without a password.

**Generate an SSH key on the server:**

```bash
ssh-keygen -t ed25519 -C "metatron-server" -f ~/.ssh/github_metatron
```

Press Enter twice to skip the passphrase.

**Print the public key:**

```bash
cat ~/.ssh/github_metatron.pub
```

**Copy the entire output**, then go to:
`https://github.com/avi-rzv/metatron/settings/keys` → **Add deploy key**

- Title: `Hostinger VPS`
- Key: paste the public key
- Allow write access: **No** (read-only is enough for pulling)

**Tell SSH to use this key for GitHub:**

```bash
cat >> ~/.ssh/config << 'EOF'
Host github.com
  HostName github.com
  User git
  IdentityFile ~/.ssh/github_metatron
EOF
chmod 600 ~/.ssh/config
```

**Test the connection:**

```bash
ssh -T git@github.com
```

You should see: `Hi avi-rzv! You've successfully authenticated...`

---

### Step 10 — Clone the Repository

```bash
mkdir -p /home/metatron/apps
cd /home/metatron/apps
git clone git@github.com:avi-rzv/metatron.git
cd metatron
```

---

### Step 11 — Install Node.js Dependencies

Install all workspace dependencies from the monorepo root:

```bash
npm install
```

This installs dependencies for both `packages/backend` and `packages/frontend`. The `node-pty` native addon will be compiled here — this may take a minute.

---

### Step 12 — Create the Production Environment File

The backend reads its configuration from a `.env` file in the `packages/backend` directory. This file is **not** committed to git and must be created manually on the server.

```bash
mkdir -p /home/metatron/apps/metatron/packages/backend/data
nano /home/metatron/apps/metatron/packages/backend/.env
```

Paste the following, replacing placeholder values:

```env
PORT=4000
HOST=127.0.0.1
MONGODB_URI=mongodb://127.0.0.1:27017
MONGODB_DB=metatron
ENCRYPTION_SECRET=a18a8fe2a0692752d5ee76f906070bee21be593ea1d6d0de2574c5a6b6578a170441fedeec82a9cfa59193d63fb11e7c
FRONTEND_ORIGIN=https://76.13.147.50
NODE_ENV=production
```

> **ENCRYPTION_SECRET**: Generate a strong secret with:
> ```bash
> node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
> ```
> Copy the output and paste it as the value.

Save and close: `Ctrl+X`, then `Y`, then `Enter`.

---

### Step 13 — Build the Project

Build the frontend (React → static files) and the backend (TypeScript → JavaScript):

```bash
npm run build
```

This runs:
1. `vite build` inside `packages/frontend` — outputs to `packages/frontend/dist/`
2. `tsc` inside `packages/backend` — outputs to `packages/backend/dist/`

---

### Step 14 — Verify MongoDB is Running

MongoDB should already be running from Step 4. Verify:

```bash
systemctl status mongod
```

No manual database initialization is needed — MongoDB creates collections and indexes automatically when the backend starts. If you are migrating from an older SQLite-based installation, run the migration script:

```bash
cd /home/metatron/apps/metatron/packages/backend
npm run migrate:sqlite-to-mongo
cd /home/metatron/apps/metatron
```

This reads data from the old `data/metatron.db` file and inserts it into MongoDB. It is safe to run multiple times.

---

### Step 15 — Start the Backend with PM2

Launch the backend and configure PM2 to manage it:

```bash
cd /home/metatron/apps/metatron
pm2 start /home/metatron/apps/metatron/packages/backend/dist/index.js --name metatron
```

Save the PM2 process list so it survives reboots:

```bash
pm2 save
```

Configure PM2 to auto-start on system boot:

```bash
pm2 startup
```

PM2 will print a command starting with `sudo env PATH=...` — **copy and run that command exactly**.

**Verify the backend is running:**

```bash
pm2 status
pm2 logs metatron --lines 30
```

The logs should show the Fastify server listening on port 4000 with no errors.

---

### Step 16 — Configure Nginx as Reverse Proxy

Nginx sits in front of the Node.js backend. It handles HTTPS termination and forwards requests to port 4000.

Create a new Nginx site config:

```bash
sudo nano /etc/nginx/sites-available/metatron
```

Paste the following (using the IP address for now — a domain can replace it later):

```nginx
server {
    listen 80;
    server_name 76.13.147.50;

    # Increase body size limit for file uploads
    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;

        # WebSocket support
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # Forward real IP to backend
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Timeouts for long-running WebSocket and SSE connections
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
```

Enable the site and disable the default placeholder:

```bash
sudo ln -s /etc/nginx/sites-available/metatron /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
```

Test the config for syntax errors:

```bash
sudo nginx -t
```

You should see: `syntax is ok` and `test is successful`.

Reload Nginx:

```bash
sudo systemctl reload nginx
```

**Test in your browser:** Open `http://76.13.147.50` — you should see the MetatronOS UI.

---

### Step 17 — Install SSL Certificate (HTTPS)

> **Note:** SSL via Let's Certbot requires a **domain name** pointing to this IP. If you are using only an IP address, skip this step for now and set up a domain first. Once you have a domain, follow the steps below.

Install Certbot:

```bash
sudo apt install -y certbot python3-certbot-nginx
```

Obtain and install a certificate (replace `yourdomain.com` with your actual domain):

```bash
sudo certbot --nginx -d yourdomain.com
```

Follow the prompts. Certbot will automatically update the Nginx config to redirect HTTP → HTTPS.

Certbot auto-renews certificates. Verify the renewal timer is active:

```bash
sudo systemctl status certbot.timer
```

**After setting up HTTPS**, update your `.env` to match:

```bash
nano /home/metatron/apps/metatron/packages/backend/.env
# Change: FRONTEND_ORIGIN=https://yourdomain.com
```

Then restart the backend:

```bash
pm2 restart metatron
```

---

### Installation Complete

The server is now running MetatronOS. Summary of what is deployed:

- **MongoDB** runs on localhost:27017, stores data in `/var/lib/mongodb`
- **PM2** manages the Node.js backend (`packages/backend/dist/index.js`) on port 4000
- **Nginx** proxies all traffic on port 80/443 to the backend
- **The backend** serves the built React frontend as static files from `packages/frontend/dist/`

---

## 2. Deploying Updates

Every update follows a two-phase workflow:
1. **Local machine**: commit and push changes to GitHub
2. **Server**: pull changes and rebuild

---

### Phase A — Push Changes to GitHub (Local Machine)

#### Step 1 — Check Current Status

Before committing, see what files have changed:

```bash
git status
git diff
```

#### Step 2 — Stage Your Changes

Stage specific files you changed (safer than `git add .`):

```bash
git add packages/backend/src/routes/chats.ts
git add packages/frontend/src/components/chat/ChatWindow.tsx
# ... add all changed files
```

Or stage everything if you are confident nothing sensitive is included:

```bash
git add .
```

> **Never stage these files:** `.env`, `credentials.txt`, `*.db`, `data/`, `node_modules/`
> These are already in `.gitignore` and will be ignored automatically.

#### Step 3 — Commit with a Descriptive Message

```bash
git commit -m "feat: add streaming LLM response support"
```

Use clear, lowercase commit messages. Common prefixes:
- `feat:` — new feature
- `fix:` — bug fix
- `refactor:` — code restructure with no behavior change
- `chore:` — config changes, dependency updates
- `docs:` — documentation only

#### Step 4 — Push to GitHub

```bash
git push origin master
```

Go to `https://github.com/avi-rzv/metatron` and confirm your changes appear there.

---

### Phase B — Pull and Apply Changes on the Server

SSH into the server:

```bash
ssh metatron@76.13.147.50
```

Navigate to the project directory:

```bash
cd /home/metatron/apps/metatron
```

#### Step 1 — Pull the Latest Code

```bash
git pull origin master
```

You should see a list of changed files. If it says `Already up to date`, the pull worked but there was nothing new.

#### Step 2 — Install Any New Dependencies

If any `package.json` files changed (new packages were added or removed), re-run install:

```bash
npm install
```

If no `package.json` files changed, you can skip this step. When in doubt, run it anyway — it is safe and idempotent.

#### Step 3 — Rebuild the Project

Always rebuild after pulling — even small TypeScript or frontend changes require a rebuild:

```bash
npm run build
```

This recompiles the TypeScript backend and re-bundles the React frontend.

#### Step 4 — Restart the Backend

Apply the new build by restarting the PM2 process:

```bash
pm2 restart metatron
```

Wait a few seconds, then verify it started cleanly:

```bash
pm2 status
pm2 logs metatron --lines 50
```

Look for the Fastify startup message. If you see errors, check the logs carefully — a missing environment variable or failed database migration is the most common cause.

#### Step 5 — Verify in the Browser

Open `http://76.13.147.50` (or your domain) and confirm the update is live and working.

---

### Quick Reference — Full Update Command Sequence

After SSHing into the server, run these commands in order:

```bash
cd /home/metatron/apps/metatron
git pull origin master
npm install
npm run build
pm2 restart metatron
pm2 logs metatron --lines 30
```

---

### Troubleshooting

**Backend fails to start after update:**
```bash
pm2 logs metatron --lines 100
```
Read the error message carefully. Common causes:
- Missing or incorrect `.env` value
- MongoDB not running (`systemctl status mongod`)
- Build failed (check `npm run build` output)

**Nginx returns 502 Bad Gateway:**
The backend is not running. Check:
```bash
pm2 status
pm2 restart metatron
```

**Port 4000 not reachable:**
The firewall should only expose 80 and 443. Port 4000 is internal — traffic goes through Nginx. This is expected.

**`git pull` asks for a password:**
The SSH key is not set up correctly. Re-check Step 9.

**`npm install` fails on native addons:**
`build-essential` and `python3` must be installed. Re-check Step 3:
```bash
sudo apt install -y build-essential python3
```

**MongoDB connection refused:**
MongoDB may not be running or may not have started on boot:
```bash
sudo systemctl start mongod
sudo systemctl enable mongod
```

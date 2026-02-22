import Database, { type Database as DatabaseType } from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import { mkdir } from 'fs/promises';
import { dirname } from 'path';

const DB_PATH = process.env.DATABASE_URL ?? './data/metatron.db';

async function ensureDir(filePath: string) {
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });
}

await ensureDir(DB_PATH);

export const sqlite: DatabaseType = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

export const db = drizzle(sqlite, { schema });

// Bootstrap tables if they don't exist
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT 'New Chat',
    provider TEXT NOT NULL DEFAULT 'gemini',
    model TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// Migrations: add columns that may not exist yet
try {
  sqlite.exec(`ALTER TABLE messages ADD COLUMN citations TEXT`);
} catch {
  // Column already exists — ignore
}

// Migration: create media table
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS media (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    prompt TEXT NOT NULL,
    short_description TEXT NOT NULL DEFAULT '',
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    model TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
`);

try {
  sqlite.exec(`ALTER TABLE media ADD COLUMN short_description TEXT NOT NULL DEFAULT ''`);
} catch {
  // Column already exists — ignore
}

try {
  sqlite.exec(`ALTER TABLE media ADD COLUMN source_media_id TEXT`);
} catch {
  // Column already exists — ignore
}

// Migration: create attachments table
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
`);

// Ensure media and uploads directories exist
await mkdir('./data/media', { recursive: true });
await mkdir('./data/uploads', { recursive: true });

export { schema };

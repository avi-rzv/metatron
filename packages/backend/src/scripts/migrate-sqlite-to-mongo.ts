/**
 * One-time migration script: SQLite → MongoDB
 *
 * Usage: npm run migrate:sqlite-to-mongo
 *
 * Reads all data from the SQLite database and inserts it into MongoDB.
 * Safe to run multiple times — uses insertMany with ordered:false to skip duplicates.
 */
import Database from 'better-sqlite3';
import { MongoClient } from 'mongodb';

const SQLITE_PATH = process.env.DATABASE_URL ?? './data/metatron.db';
const MONGODB_URI = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017';
const MONGODB_DB = process.env.MONGODB_DB ?? 'metatron';

interface SqliteRow {
  [key: string]: unknown;
}

async function migrate() {
  console.log(`Opening SQLite: ${SQLITE_PATH}`);
  const sqlite = new Database(SQLITE_PATH, { readonly: true });

  console.log(`Connecting to MongoDB: ${MONGODB_URI}/${MONGODB_DB}`);
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db(MONGODB_DB);

  // Helper: convert SQLite timestamp (epoch seconds) to Date
  function toDate(val: unknown): Date {
    if (val instanceof Date) return val;
    if (typeof val === 'number') return new Date(val * 1000);
    if (typeof val === 'string') return new Date(val);
    return new Date();
  }

  // Helper: safe insert that skips duplicates
  async function bulkInsert(colName: string, docs: Record<string, unknown>[]) {
    if (docs.length === 0) {
      console.log(`  ${colName}: 0 rows (skipped)`);
      return;
    }
    try {
      const result = await db.collection(colName).insertMany(docs, { ordered: false });
      console.log(`  ${colName}: ${result.insertedCount} inserted`);
    } catch (err: any) {
      // Duplicate key errors are fine (re-running migration)
      if (err.code === 11000) {
        const inserted = err.result?.insertedCount ?? 'some';
        console.log(`  ${colName}: ${inserted} inserted (duplicates skipped)`);
      } else {
        throw err;
      }
    }
  }

  // --- Migrate chats ---
  console.log('\nMigrating chats...');
  const chats = sqlite.prepare('SELECT * FROM chats').all() as SqliteRow[];
  await bulkInsert('chats', chats.map((r) => ({
    _id: r.id as string,
    title: r.title as string,
    provider: r.provider as string,
    model: r.model as string,
    createdAt: toDate(r.created_at),
    updatedAt: toDate(r.updated_at),
  })));

  // --- Migrate messages ---
  console.log('Migrating messages...');
  const messages = sqlite.prepare('SELECT * FROM messages').all() as SqliteRow[];
  await bulkInsert('messages', messages.map((r) => {
    let citations: Array<{ url: string; title: string }> | null = null;
    if (r.citations && typeof r.citations === 'string') {
      try { citations = JSON.parse(r.citations); } catch { /* ignore */ }
    }
    return {
      _id: r.id as string,
      chatId: r.chat_id as string,
      role: r.role as string,
      content: r.content as string,
      citations,
      createdAt: toDate(r.created_at),
    };
  }));

  // --- Migrate settings ---
  console.log('Migrating settings...');
  const settings = sqlite.prepare('SELECT * FROM settings').all() as SqliteRow[];
  await bulkInsert('settings', settings.map((r) => ({
    _id: r.key as string,
    value: r.value as string,
  })));

  // --- Migrate media ---
  console.log('Migrating media...');
  try {
    const mediaRows = sqlite.prepare('SELECT * FROM media').all() as SqliteRow[];
    await bulkInsert('media', mediaRows.map((r) => ({
      _id: r.id as string,
      chatId: r.chat_id as string,
      messageId: r.message_id as string,
      filename: r.filename as string,
      prompt: r.prompt as string,
      shortDescription: (r.short_description as string) ?? '',
      mimeType: r.mime_type as string,
      size: r.size as number,
      model: r.model as string,
      sourceMediaId: (r.source_media_id as string) ?? null,
      createdAt: toDate(r.created_at),
    })));
  } catch {
    console.log('  media: table not found (skipped)');
  }

  // --- Migrate attachments ---
  console.log('Migrating attachments...');
  try {
    const attachmentRows = sqlite.prepare('SELECT * FROM attachments').all() as SqliteRow[];
    await bulkInsert('attachments', attachmentRows.map((r) => ({
      _id: r.id as string,
      chatId: r.chat_id as string,
      messageId: r.message_id as string,
      filename: r.filename as string,
      originalName: r.original_name as string,
      mimeType: r.mime_type as string,
      size: r.size as number,
      createdAt: toDate(r.created_at),
    })));
  } catch {
    console.log('  attachments: table not found (skipped)');
  }

  // --- Migrate ai_ prefixed tables ---
  console.log('Migrating ai_ tables...');
  const tables = sqlite.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'ai_%'"
  ).all() as Array<{ name: string }>;

  for (const { name } of tables) {
    const rows = sqlite.prepare(`SELECT * FROM "${name}"`).all() as SqliteRow[];
    if (rows.length === 0) {
      console.log(`  ${name}: 0 rows (skipped)`);
      continue;
    }
    // For ai_ tables, keep row structure as-is but rename 'id' to '_id' if present
    const docs = rows.map((r) => {
      const doc: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(r)) {
        if (k === 'id') {
          doc._id = v;
        } else {
          doc[k] = v;
        }
      }
      return doc;
    });
    await bulkInsert(name, docs);
  }

  // --- Done ---
  console.log('\nMigration complete!');
  console.log(`  Chats: ${chats.length}`);
  console.log(`  Messages: ${messages.length}`);
  console.log(`  Settings: ${settings.length}`);
  console.log(`  AI tables: ${tables.length}`);

  sqlite.close();
  await client.close();
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});

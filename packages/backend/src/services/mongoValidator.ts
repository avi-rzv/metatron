import { database } from '../db/index.js';

export interface MongoOperation {
  operation: string;
  collection: string;
  filter?: Record<string, unknown>;
  data?: Record<string, unknown> | Record<string, unknown>[];
  update?: Record<string, unknown>;
  sort?: Record<string, 1 | -1>;
  limit?: number;
  skip?: number;
  pipeline?: Record<string, unknown>[];
  projection?: Record<string, 0 | 1>;
  indexSpec?: Record<string, 1 | -1>;
  indexOptions?: Record<string, unknown>;
}

const ALLOWED_OPERATIONS = new Set([
  'find', 'findOne',
  'insertOne', 'insertMany',
  'updateOne', 'updateMany',
  'deleteOne', 'deleteMany',
  'countDocuments',
  'aggregate',
  'createCollection', 'createIndex',
  'listCollections',
]);

const PROTECTED_COLLECTIONS = new Set([
  'chats', 'messages', 'settings', 'media', 'attachments',
]);

const AI_MANAGED_COLLECTIONS = new Set([
  'master', 'contacts', 'schedule', 'whatsapp_permissions', 'whatsapp_group_permissions', 'cronjobs',
]);

const WRITE_OPERATIONS = new Set([
  'insertOne', 'insertMany',
  'updateOne', 'updateMany',
  'deleteOne', 'deleteMany',
  'createCollection', 'createIndex',
]);

export function validateMongoOperation(op: MongoOperation): { valid: boolean; error?: string } {
  if (!op.operation || !ALLOWED_OPERATIONS.has(op.operation)) {
    return { valid: false, error: `Operation '${op.operation}' is not allowed. Allowed: ${[...ALLOWED_OPERATIONS].join(', ')}` };
  }

  if (op.operation === 'listCollections') {
    return { valid: true };
  }

  if (!op.collection) {
    return { valid: false, error: 'Collection name is required.' };
  }

  // Protected collections are read-only for AI
  if (PROTECTED_COLLECTIONS.has(op.collection) && WRITE_OPERATIONS.has(op.operation)) {
    return {
      valid: false,
      error: `Access denied: '${op.collection}' is a protected core collection. You can only read from it. Write operations are restricted to collections with the 'ai_' prefix.`,
    };
  }

  // Write operations require ai_ prefix or AI-managed collection
  if (WRITE_OPERATIONS.has(op.operation) && !op.collection.startsWith('ai_') && !AI_MANAGED_COLLECTIONS.has(op.collection)) {
    return {
      valid: false,
      error: `Write operations are restricted to AI-managed collections (master, contacts, schedule) or collections with the 'ai_' prefix. Use 'ai_${op.collection}' instead.`,
    };
  }

  return { valid: true };
}

export async function executeAIOperation(op: MongoOperation): Promise<string> {
  const validation = validateMongoOperation(op);
  if (!validation.valid) {
    return JSON.stringify({ error: validation.error });
  }

  try {
    const col = database.collection(op.collection);

    switch (op.operation) {
      case 'find': {
        let cursor = col.find(op.filter ?? {});
        if (op.projection) cursor = cursor.project(op.projection);
        if (op.sort) cursor = cursor.sort(op.sort);
        if (op.skip) cursor = cursor.skip(op.skip);
        if (op.limit) cursor = cursor.limit(op.limit);
        const rows = await cursor.toArray();
        return JSON.stringify({ rows });
      }
      case 'findOne': {
        const doc = await col.findOne(op.filter ?? {}, op.projection ? { projection: op.projection } : {});
        return JSON.stringify({ row: doc });
      }
      case 'insertOne': {
        if (!op.data || Array.isArray(op.data)) {
          return JSON.stringify({ error: 'insertOne requires a single data object.' });
        }
        const result = await col.insertOne(op.data);
        return JSON.stringify({ insertedId: result.insertedId });
      }
      case 'insertMany': {
        if (!op.data || !Array.isArray(op.data)) {
          return JSON.stringify({ error: 'insertMany requires a data array.' });
        }
        const result = await col.insertMany(op.data);
        return JSON.stringify({ insertedCount: result.insertedCount });
      }
      case 'updateOne': {
        if (!op.update) return JSON.stringify({ error: 'updateOne requires an update object.' });
        const result = await col.updateOne(op.filter ?? {}, op.update);
        return JSON.stringify({ matchedCount: result.matchedCount, modifiedCount: result.modifiedCount });
      }
      case 'updateMany': {
        if (!op.update) return JSON.stringify({ error: 'updateMany requires an update object.' });
        const result = await col.updateMany(op.filter ?? {}, op.update);
        return JSON.stringify({ matchedCount: result.matchedCount, modifiedCount: result.modifiedCount });
      }
      case 'deleteOne': {
        const result = await col.deleteOne(op.filter ?? {});
        return JSON.stringify({ deletedCount: result.deletedCount });
      }
      case 'deleteMany': {
        const result = await col.deleteMany(op.filter ?? {});
        return JSON.stringify({ deletedCount: result.deletedCount });
      }
      case 'countDocuments': {
        const count = await col.countDocuments(op.filter ?? {});
        return JSON.stringify({ count });
      }
      case 'aggregate': {
        if (!op.pipeline) return JSON.stringify({ error: 'aggregate requires a pipeline array.' });
        const rows = await col.aggregate(op.pipeline).toArray();
        return JSON.stringify({ rows });
      }
      case 'createCollection': {
        await database.createCollection(op.collection);
        return JSON.stringify({ success: true });
      }
      case 'createIndex': {
        if (!op.indexSpec) return JSON.stringify({ error: 'createIndex requires an indexSpec object.' });
        const name = await col.createIndex(op.indexSpec, op.indexOptions ?? {});
        return JSON.stringify({ success: true, indexName: name });
      }
      case 'listCollections': {
        const collections = await database.listCollections().toArray();
        return JSON.stringify({ collections: collections.map((c) => c.name) });
      }
      default:
        return JSON.stringify({ error: `Unknown operation: ${op.operation}` });
    }
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
  }
}

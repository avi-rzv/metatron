import { sqlite } from '../db/index.js';
import { updateMemory, updateDbSchema } from './systemInstruction.js';
import { validateAIQuery } from './sqlValidator.js';

export interface AIToolCallbacks {
  saveMemory: (memory: string) => Promise<string>;
  dbQuery: (sql: string) => Promise<string>;
  updateDbSchema: (schema: string) => Promise<string>;
}

export function createAIToolCallbacks(): AIToolCallbacks {
  return {
    async saveMemory(memory: string): Promise<string> {
      try {
        await updateMemory(memory);
        return JSON.stringify({ success: true, message: 'Memory updated successfully' });
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    },

    async dbQuery(sql: string): Promise<string> {
      const validation = validateAIQuery(sql);
      if (!validation.valid) {
        return JSON.stringify({ error: validation.error });
      }

      try {
        const trimmed = sql.trim().toUpperCase();
        if (trimmed.startsWith('SELECT') || trimmed.startsWith('PRAGMA') || trimmed.startsWith('EXPLAIN')) {
          const rows = sqlite.prepare(sql).all();
          return JSON.stringify({ rows });
        } else if (
          trimmed.startsWith('INSERT') ||
          trimmed.startsWith('UPDATE') ||
          trimmed.startsWith('DELETE')
        ) {
          const result = sqlite.prepare(sql).run();
          return JSON.stringify({ affectedRows: result.changes });
        } else {
          // CREATE, ALTER, DROP, etc.
          sqlite.exec(sql);
          return JSON.stringify({ success: true });
        }
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    },

    async updateDbSchema(schema: string): Promise<string> {
      try {
        await updateDbSchema(schema);
        return JSON.stringify({ success: true, message: 'Schema updated successfully' });
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  };
}

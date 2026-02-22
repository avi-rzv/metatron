import { sqlite, db } from '../db/index.js';
import { media } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { updateMemory, updateDbSchema } from './systemInstruction.js';
import { validateAIQuery } from './sqlValidator.js';
import { braveWebSearch } from './braveSearch.js';
import { generateImage, editImage, saveImageToDisk, loadImageFromDisk } from './imageGeneration.js';
import { nanoid } from 'nanoid';
import type { AppSettings } from './settings.js';

export interface MediaInfo {
  mediaId: string;
  filename: string;
  prompt: string;
  model: string;
}

export interface AIToolCallbacks {
  saveMemory: (memory: string) => Promise<string>;
  dbQuery: (sql: string) => Promise<string>;
  updateDbSchema: (schema: string) => Promise<string>;
  webSearch?: (query: string) => Promise<string>;
  generateImage?: (prompt: string, shortDescription: string) => Promise<string>;
  editImage?: (imageId: string, prompt: string, shortDescription: string) => Promise<string>;
}

export interface AIToolOptions {
  braveApiKey?: string;
  chatId?: string;
  messageId?: string;
  settings?: AppSettings;
  onImageGenerated?: (media: MediaInfo) => void;
}

export function createAIToolCallbacks(opts: AIToolOptions = {}): AIToolCallbacks {
  const { braveApiKey, chatId, messageId, settings, onImageGenerated } = opts;
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

    ...(braveApiKey
      ? {
          async webSearch(query: string): Promise<string> {
            try {
              const results = await braveWebSearch(braveApiKey, query);
              return JSON.stringify({ results });
            } catch (err) {
              return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
            }
          },
        }
      : {}),

    ...(settings && chatId && messageId
      ? {
          async generateImage(prompt: string, shortDescription: string): Promise<string> {
            try {
              const result = await generateImage(prompt, settings);
              const saved = await saveImageToDisk(result.base64, result.mimeType);
              const mediaId = nanoid();
              const desc = shortDescription || prompt.split(/\s+/).slice(0, 5).join(' ');

              db.insert(media)
                .values({
                  id: mediaId,
                  chatId,
                  messageId,
                  filename: saved.filename,
                  prompt,
                  shortDescription: desc,
                  mimeType: result.mimeType,
                  size: saved.size,
                  model: result.modelUsed,
                  createdAt: new Date(),
                })
                .run();

              onImageGenerated?.({ mediaId, filename: saved.filename, prompt, model: result.modelUsed });

              return JSON.stringify({
                success: true,
                imageId: mediaId,
                message: 'Image generated successfully',
              });
            } catch (err) {
              return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
            }
          },
          async editImage(imageId: string, prompt: string, shortDescription: string): Promise<string> {
            try {
              // Look up source media record
              const sourceMedia = db.select().from(media).where(eq(media.id, imageId)).get();
              if (!sourceMedia) {
                return JSON.stringify({ error: `Image with id ${imageId} not found` });
              }

              // Load source image from disk
              const source = await loadImageFromDisk(sourceMedia.filename);

              // Edit the image
              const result = await editImage(prompt, source.base64, source.mimeType, settings);
              const saved = await saveImageToDisk(result.base64, result.mimeType);
              const newMediaId = nanoid();
              const desc = shortDescription || prompt.split(/\s+/).slice(0, 5).join(' ');

              db.insert(media)
                .values({
                  id: newMediaId,
                  chatId,
                  messageId,
                  filename: saved.filename,
                  prompt,
                  shortDescription: desc,
                  mimeType: result.mimeType,
                  size: saved.size,
                  model: result.modelUsed,
                  sourceMediaId: sourceMedia.id,
                  createdAt: new Date(),
                })
                .run();

              onImageGenerated?.({ mediaId: newMediaId, filename: saved.filename, prompt, model: result.modelUsed });

              return JSON.stringify({
                success: true,
                imageId: newMediaId,
                message: 'Image edited successfully',
              });
            } catch (err) {
              return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
            }
          },
        }
      : {}),
  };
}

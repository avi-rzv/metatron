import type { FastifyInstance } from 'fastify';
import { db } from '../db/index.js';
import { media } from '../db/schema.js';
import { eq, desc } from 'drizzle-orm';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { createReadStream, existsSync } from 'fs';

const MEDIA_DIR = './data/media';

export async function mediaRoutes(fastify: FastifyInstance) {
  // GET /api/media — list all media
  fastify.get<{ Querystring: { limit?: string } }>('/api/media', async (req) => {
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    return db.select().from(media).orderBy(desc(media.createdAt)).limit(limit).all();
  });

  // GET /api/media/:id/file — serve image file
  fastify.get<{ Params: { id: string } }>('/api/media/:id/file', async (req, reply) => {
    const row = db.select().from(media).where(eq(media.id, req.params.id)).get();
    if (!row) {
      reply.status(404).send({ error: 'Media not found' });
      return;
    }

    const filepath = join(MEDIA_DIR, row.filename);
    if (!existsSync(filepath)) {
      reply.status(404).send({ error: 'File not found on disk' });
      return;
    }

    reply.header('Content-Type', row.mimeType);
    reply.header('Cache-Control', 'public, max-age=31536000, immutable');
    return reply.send(createReadStream(filepath));
  });

  // DELETE /api/media/:id — delete media
  fastify.delete<{ Params: { id: string } }>('/api/media/:id', async (req, reply) => {
    const row = db.select().from(media).where(eq(media.id, req.params.id)).get();
    if (!row) {
      reply.status(404).send({ error: 'Media not found' });
      return;
    }

    // Delete file from disk
    const filepath = join(MEDIA_DIR, row.filename);
    try {
      await unlink(filepath);
    } catch {
      // File may already be gone — continue with DB cleanup
    }

    db.delete(media).where(eq(media.id, req.params.id)).run();
    reply.status(204).send();
  });
}

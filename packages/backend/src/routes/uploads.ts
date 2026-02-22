import type { FastifyInstance } from 'fastify';
import { db } from '../db/index.js';
import { attachments } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { join } from 'path';
import { unlink, stat } from 'fs/promises';
import { createReadStream, existsSync } from 'fs';

const UPLOADS_DIR = './data/uploads';

export async function uploadRoutes(fastify: FastifyInstance) {
  // GET /api/uploads/:id/file — serve uploaded file
  fastify.get<{ Params: { id: string } }>('/api/uploads/:id/file', async (req, reply) => {
    const row = db.select().from(attachments).where(eq(attachments.id, req.params.id)).get();
    if (!row) {
      reply.status(404).send({ error: 'Attachment not found' });
      return;
    }

    const filepath = join(UPLOADS_DIR, row.filename);
    if (!existsSync(filepath)) {
      reply.status(404).send({ error: 'File not found on disk' });
      return;
    }

    const fileStat = await stat(filepath);
    const fileSize = fileStat.size;
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;

      reply.header('Content-Type', row.mimeType);
      reply.header('Content-Range', `bytes ${start}-${end}/${fileSize}`);
      reply.header('Accept-Ranges', 'bytes');
      reply.header('Content-Length', chunkSize);
      reply.status(206);
      return reply.send(createReadStream(filepath, { start, end }));
    }

    reply.header('Content-Type', row.mimeType);
    reply.header('Accept-Ranges', 'bytes');
    reply.header('Content-Length', fileSize);
    reply.header('Cache-Control', 'public, max-age=31536000, immutable');
    return reply.send(createReadStream(filepath));
  });

  // DELETE /api/uploads/:id — delete uploaded file
  fastify.delete<{ Params: { id: string } }>('/api/uploads/:id', async (req, reply) => {
    const row = db.select().from(attachments).where(eq(attachments.id, req.params.id)).get();
    if (!row) {
      reply.status(404).send({ error: 'Attachment not found' });
      return;
    }

    const filepath = join(UPLOADS_DIR, row.filename);
    try {
      await unlink(filepath);
    } catch {
      // File may already be gone — continue with DB cleanup
    }

    db.delete(attachments).where(eq(attachments.id, req.params.id)).run();
    reply.status(204).send();
  });
}

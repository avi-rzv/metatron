import type { FastifyInstance } from 'fastify';
import {
  getSystemInstruction,
  updateSystemInstruction,
  type SystemInstruction,
} from '../services/systemInstruction.js';

export async function systemInstructionRoutes(fastify: FastifyInstance) {
  // GET /api/system-instruction
  fastify.get('/api/system-instruction', async () => {
    return getSystemInstruction();
  });

  // PUT /api/system-instruction — merge-update fields
  fastify.put<{ Body: Partial<SystemInstruction> }>(
    '/api/system-instruction',
    async (req) => {
      return updateSystemInstruction(req.body);
    },
  );

  // DELETE /api/system-instruction/memory — clear memory
  fastify.delete('/api/system-instruction/memory', async (_, reply) => {
    await updateSystemInstruction({ memory: '' });
    reply.status(204).send();
  });

  // DELETE /api/system-instruction/db-schema — clear schema
  fastify.delete('/api/system-instruction/db-schema', async (_, reply) => {
    await updateSystemInstruction({ dbSchema: '' });
    reply.status(204).send();
  });
}

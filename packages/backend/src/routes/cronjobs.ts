import type { FastifyInstance } from 'fastify';
import { cronjobsCol } from '../db/index.js';
import { deleteCronJob } from '../db/cascade.js';
import { createCronJob, updateCronJob, toggleCronJob } from '../services/cronService.js';
import { toApiDoc, toApiDocs } from '../db/utils.js';

export async function cronjobRoutes(fastify: FastifyInstance) {
  // GET /api/cronjobs
  fastify.get('/api/cronjobs', async () => {
    const docs = await cronjobsCol.find({}).sort({ createdAt: -1 }).toArray();
    return toApiDocs(docs);
  });

  // POST /api/cronjobs
  fastify.post<{
    Body: { name: string; instruction: string; cronExpression: string; timezone?: string };
  }>('/api/cronjobs', async (req, reply) => {
    const { name, instruction, cronExpression, timezone } = req.body;

    if (!name?.trim()) {
      reply.status(400).send({ error: 'name is required' });
      return;
    }
    if (!instruction?.trim()) {
      reply.status(400).send({ error: 'instruction is required' });
      return;
    }
    if (!cronExpression?.trim()) {
      reply.status(400).send({ error: 'cronExpression is required' });
      return;
    }

    try {
      const job = await createCronJob({ name: name.trim(), instruction: instruction.trim(), cronExpression: cronExpression.trim(), timezone });
      return toApiDoc(job);
    } catch (err) {
      reply.status(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // PATCH /api/cronjobs/:id
  fastify.patch<{
    Params: { id: string };
    Body: { name?: string; instruction?: string; cronExpression?: string; timezone?: string; enabled?: boolean };
  }>('/api/cronjobs/:id', async (req, reply) => {
    const { id } = req.params;
    const { name, instruction, cronExpression, timezone, enabled } = req.body;

    try {
      const job = await updateCronJob(id, { name, instruction, cronExpression, timezone, enabled });
      if (!job) {
        reply.status(404).send({ error: 'Cronjob not found' });
        return;
      }
      return toApiDoc(job);
    } catch (err) {
      reply.status(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // DELETE /api/cronjobs/:id
  fastify.delete<{ Params: { id: string } }>('/api/cronjobs/:id', async (req, reply) => {
    const deleted = await deleteCronJob(req.params.id);
    if (!deleted) {
      reply.status(404).send({ error: 'Cronjob not found' });
      return;
    }
    return { success: true };
  });

  // POST /api/cronjobs/:id/toggle
  fastify.post<{ Params: { id: string } }>('/api/cronjobs/:id/toggle', async (req, reply) => {
    const job = await toggleCronJob(req.params.id);
    if (!job) {
      reply.status(404).send({ error: 'Cronjob not found' });
      return;
    }
    return toApiDoc(job);
  });
}

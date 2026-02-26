import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import { waPermissionsCol } from '../db/index.js';
import { toApiDoc, toApiDocs } from '../db/utils.js';

export async function whatsappPermissionRoutes(fastify: FastifyInstance) {
  // GET /api/whatsapp/permissions
  fastify.get('/api/whatsapp/permissions', async () => {
    const docs = await waPermissionsCol.find({}).sort({ displayName: 1 }).toArray();
    return toApiDocs(docs);
  });

  // POST /api/whatsapp/permissions
  fastify.post<{
    Body: { phoneNumber: string; displayName: string; canRead?: boolean; canReply?: boolean };
  }>('/api/whatsapp/permissions', async (req, reply) => {
    const { phoneNumber, displayName, canRead, canReply } = req.body;

    if (!phoneNumber?.trim() || !displayName?.trim()) {
      reply.status(400).send({ error: 'phoneNumber and displayName are required' });
      return;
    }

    const cleaned = phoneNumber.replace(/[^0-9]/g, '');
    if (!cleaned) {
      reply.status(400).send({ error: 'Invalid phone number' });
      return;
    }

    // Check for duplicate phone number
    const existing = await waPermissionsCol.findOne({ phoneNumber: cleaned });
    if (existing) {
      reply.status(409).send({ error: 'Permission already exists for this phone number' });
      return;
    }

    const now = new Date();
    const doc = {
      _id: nanoid(),
      phoneNumber: cleaned,
      displayName: displayName.trim(),
      contactId: null,
      canRead: canRead ?? false,
      canReply: canReply ?? false,
      chatInstructions: null,
      chatId: null,
      createdAt: now,
      updatedAt: now,
    };

    await waPermissionsCol.insertOne(doc);
    return toApiDoc(doc);
  });

  // PATCH /api/whatsapp/permissions/:id
  fastify.patch<{
    Params: { id: string };
    Body: { displayName?: string; canRead?: boolean; canReply?: boolean; chatInstructions?: string | null };
  }>('/api/whatsapp/permissions/:id', async (req, reply) => {
    const { id } = req.params;
    const { displayName, canRead, canReply, chatInstructions } = req.body;

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (displayName !== undefined) updates.displayName = displayName.trim();
    if (canRead !== undefined) updates.canRead = canRead;
    if (canReply !== undefined) updates.canReply = canReply;
    if (chatInstructions !== undefined) updates.chatInstructions = chatInstructions;

    const result = await waPermissionsCol.findOneAndUpdate(
      { _id: id },
      { $set: updates },
      { returnDocument: 'after' },
    );

    if (!result) {
      reply.status(404).send({ error: 'Permission not found' });
      return;
    }

    return toApiDoc(result);
  });

  // DELETE /api/whatsapp/permissions/:id
  fastify.delete<{ Params: { id: string } }>('/api/whatsapp/permissions/:id', async (req, reply) => {
    const result = await waPermissionsCol.deleteOne({ _id: req.params.id });
    if (result.deletedCount === 0) {
      reply.status(404).send({ error: 'Permission not found' });
      return;
    }
    return { success: true };
  });
}

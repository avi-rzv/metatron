import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import { waGroupPermissionsCol } from '../db/index.js';
import { toApiDoc, toApiDocs } from '../db/utils.js';

export async function whatsappGroupPermissionRoutes(fastify: FastifyInstance) {
  // GET /api/whatsapp/group-permissions
  fastify.get('/api/whatsapp/group-permissions', async () => {
    const docs = await waGroupPermissionsCol.find({}).sort({ groupName: 1 }).toArray();
    return toApiDocs(docs);
  });

  // POST /api/whatsapp/group-permissions
  fastify.post<{
    Body: { groupJid: string; groupName: string; canRead?: boolean; canReply?: boolean };
  }>('/api/whatsapp/group-permissions', async (req, reply) => {
    const { groupJid, groupName, canRead, canReply } = req.body;

    if (!groupJid?.trim() || !groupName?.trim()) {
      reply.status(400).send({ error: 'groupJid and groupName are required' });
      return;
    }

    if (!groupJid.includes('@g.us')) {
      reply.status(400).send({ error: 'Invalid group JID — must end with @g.us' });
      return;
    }

    // Check for duplicate
    const existing = await waGroupPermissionsCol.findOne({ groupJid });
    if (existing) {
      reply.status(409).send({ error: 'Permission already exists for this group' });
      return;
    }

    const now = new Date();
    const doc = {
      _id: nanoid(),
      groupJid,
      groupName: groupName.trim(),
      canRead: canRead ?? false,
      canReply: canReply ?? false,
      chatInstructions: null,
      chatId: null,
      createdAt: now,
      updatedAt: now,
    };

    await waGroupPermissionsCol.insertOne(doc);
    return toApiDoc(doc);
  });

  // PATCH /api/whatsapp/group-permissions/:id
  fastify.patch<{
    Params: { id: string };
    Body: { groupName?: string; canRead?: boolean; canReply?: boolean; chatInstructions?: string | null };
  }>('/api/whatsapp/group-permissions/:id', async (req, reply) => {
    const { id } = req.params;
    const { groupName, canRead, canReply, chatInstructions } = req.body;

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (groupName !== undefined) updates.groupName = groupName.trim();
    if (canRead !== undefined) updates.canRead = canRead;
    if (canReply !== undefined) updates.canReply = canReply;
    if (chatInstructions !== undefined) updates.chatInstructions = chatInstructions;

    const result = await waGroupPermissionsCol.findOneAndUpdate(
      { _id: id },
      { $set: updates },
      { returnDocument: 'after' },
    );

    if (!result) {
      reply.status(404).send({ error: 'Group permission not found' });
      return;
    }

    return toApiDoc(result);
  });

  // DELETE /api/whatsapp/group-permissions/:id
  fastify.delete<{ Params: { id: string } }>('/api/whatsapp/group-permissions/:id', async (req, reply) => {
    const result = await waGroupPermissionsCol.deleteOne({ _id: req.params.id });
    if (result.deletedCount === 0) {
      reply.status(404).send({ error: 'Group permission not found' });
      return;
    }
    return { success: true };
  });
}

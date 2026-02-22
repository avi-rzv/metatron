import type { FastifyInstance } from 'fastify';
import { db } from '../db/index.js';
import { chats, messages, media, attachments } from '../db/schema.js';
import { eq, desc } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { writeFile } from 'fs/promises';
import { join, extname } from 'path';
import { getDecryptedSettings, getThinkingLevelForModel } from '../services/settings.js';
import { streamGeminiChat, type GeminiMessage } from '../services/llm/gemini.js';
import { streamOpenAIChat, type OpenAIMessage } from '../services/llm/openai.js';
import { buildCombinedPrompt, getSystemInstruction } from '../services/systemInstruction.js';
import { createAIToolCallbacks, type MediaInfo } from '../services/aiTools.js';

/**
 * If the model output a JSON object instead of plain text, extract the
 * human-readable text from it. Handles multiple patterns:
 *   { "text": "..." }
 *   { "action": "...", "thought": "..." }
 *   { "response": "..." }
 * Also strips JSON blocks embedded in otherwise normal text.
 */
function stripJsonWrapper(content: string): string {
  const trimmed = content.trim();

  // Entire response is a single JSON object
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed);
      // Pick the best text field available
      const text = parsed.text ?? parsed.content ?? parsed.response ?? parsed.thought ?? parsed.message;
      if (typeof text === 'string' && text.trim()) {
        return text.trim();
      }
      // If it's a tool-call echo (action/action_input), discard entirely
      if (parsed.action && parsed.action_input !== undefined) {
        return '';
      }
    } catch {
      // Not valid JSON — fall through
    }
  }

  // JSON block(s) embedded in surrounding text — strip them out
  const cleaned = content.replace(/^\s*```(?:json)?\s*\{[\s\S]*?\}\s*```\s*/gm, '').trim();
  if (cleaned && cleaned !== content.trim()) {
    return cleaned;
  }

  return content;
}

export async function chatRoutes(fastify: FastifyInstance) {
  // GET /api/chats
  fastify.get('/api/chats', async () => {
    return db.select().from(chats).orderBy(desc(chats.updatedAt)).all();
  });

  // POST /api/chats — create new chat
  fastify.post<{
    Body: { title?: string; provider: string; model: string };
  }>('/api/chats', async (req) => {
    const id = nanoid();
    const now = new Date();
    const chat = {
      id,
      title: req.body.title ?? 'New Chat',
      provider: req.body.provider,
      model: req.body.model,
      createdAt: now,
      updatedAt: now,
    };
    db.insert(chats).values(chat).run();
    return chat;
  });

  // GET /api/chats/:id
  fastify.get<{ Params: { id: string } }>('/api/chats/:id', async (req, reply) => {
    const chat = db.select().from(chats).where(eq(chats.id, req.params.id)).get();
    if (!chat) {
      reply.status(404).send({ error: 'Chat not found' });
      return;
    }
    const msgs = db
      .select()
      .from(messages)
      .where(eq(messages.chatId, req.params.id))
      .orderBy(messages.createdAt)
      .all();
    const allMedia = db
      .select()
      .from(media)
      .where(eq(media.chatId, req.params.id))
      .all();
    const mediaByMessage = new Map<string, typeof allMedia>();
    for (const m of allMedia) {
      const arr = mediaByMessage.get(m.messageId) ?? [];
      arr.push(m);
      mediaByMessage.set(m.messageId, arr);
    }
    const allAttachments = db
      .select()
      .from(attachments)
      .where(eq(attachments.chatId, req.params.id))
      .all();
    const attachmentsByMessage = new Map<string, typeof allAttachments>();
    for (const a of allAttachments) {
      const arr = attachmentsByMessage.get(a.messageId) ?? [];
      arr.push(a);
      attachmentsByMessage.set(a.messageId, arr);
    }
    const enrichedMsgs = msgs.map((m) => ({
      ...m,
      citations: m.citations ? JSON.parse(m.citations) : null,
      media: mediaByMessage.get(m.id) ?? [],
      attachments: attachmentsByMessage.get(m.id) ?? [],
    }));
    return { ...chat, messages: enrichedMsgs };
  });

  // DELETE /api/chats/:id
  fastify.delete<{ Params: { id: string } }>('/api/chats/:id', async (req, reply) => {
    db.delete(chats).where(eq(chats.id, req.params.id)).run();
    reply.status(204).send();
  });

  // PATCH /api/chats/:id — update title
  fastify.patch<{ Params: { id: string }; Body: { title: string } }>(
    '/api/chats/:id',
    async (req) => {
      db.update(chats)
        .set({ title: req.body.title, updatedAt: new Date() })
        .where(eq(chats.id, req.params.id))
        .run();
      return db.select().from(chats).where(eq(chats.id, req.params.id)).get();
    }
  );

  // POST /api/chats/:id/stream — SSE streaming message
  fastify.post<{
    Params: { id: string };
    Body: {
      content: string;
      provider?: string;
      model?: string;
      attachments?: Array<{ name: string; mimeType: string; data: string }>;
      audio?: { filename: string; mimeType: string; size: number };
    };
  }>('/api/chats/:id/stream', async (req, reply) => {
    const chat = db.select().from(chats).where(eq(chats.id, req.params.id)).get();
    if (!chat) {
      reply.status(404).send({ error: 'Chat not found' });
      return;
    }

    const userContent = req.body.content?.trim();
    const incomingAttachments = req.body.attachments ?? [];
    if (!userContent && incomingAttachments.length === 0) {
      reply.status(400).send({ error: 'Content or attachments required' });
      return;
    }

    // Use provider/model from request if provided (user changed selector), else fall back to chat's stored values
    const activeProvider = req.body.provider ?? chat.provider;
    const activeModel = req.body.model ?? chat.model;

    // Save user message
    const userMsgId = nanoid();
    const now = new Date();
    db.insert(messages)
      .values({ id: userMsgId, chatId: chat.id, role: 'user', content: userContent ?? '', createdAt: now })
      .run();

    // Save attachments to disk and DB
    const savedAttachments: Array<{ mimeType: string; data: string; name: string }> = [];
    for (const att of incomingAttachments) {
      const ext = extname(att.name) || '.bin';
      const filename = nanoid() + ext;
      const filepath = join('./data/uploads', filename);
      const buffer = Buffer.from(att.data, 'base64');
      await writeFile(filepath, buffer);
      const attId = nanoid();
      db.insert(attachments).values({
        id: attId,
        chatId: chat.id,
        messageId: userMsgId,
        filename,
        originalName: att.name,
        mimeType: att.mimeType,
        size: buffer.length,
        createdAt: now,
      }).run();
      savedAttachments.push({ mimeType: att.mimeType, data: att.data, name: att.name });
    }

    // Save voice audio as attachment if provided
    if (req.body.audio) {
      const audio = req.body.audio;
      const audioAttId = nanoid();
      db.insert(attachments).values({
        id: audioAttId,
        chatId: chat.id,
        messageId: userMsgId,
        filename: audio.filename,
        originalName: 'voice-message' + (audio.filename.substring(audio.filename.lastIndexOf('.')) || '.webm'),
        mimeType: audio.mimeType,
        size: audio.size,
        createdAt: now,
      }).run();
    }

    // Auto-title the chat after first message
    const msgCount = db.select().from(messages).where(eq(messages.chatId, chat.id)).all().length;
    if (msgCount <= 1) {
      const title = userContent.slice(0, 60) + (userContent.length > 60 ? '…' : '');
      db.update(chats).set({ title, updatedAt: new Date() }).where(eq(chats.id, chat.id)).run();
    } else {
      db.update(chats).set({ updatedAt: new Date() }).where(eq(chats.id, chat.id)).run();
    }

    // Load conversation history
    const history = db
      .select()
      .from(messages)
      .where(eq(messages.chatId, chat.id))
      .orderBy(messages.createdAt)
      .all()
      .filter((m) => m.id !== userMsgId); // exclude the just-inserted message

    // Query all media for this chat and group by messageId
    const allMedia = db.select().from(media).where(eq(media.chatId, chat.id)).all();
    const mediaByMsgId = new Map<string, typeof allMedia>();
    for (const m of allMedia) {
      const arr = mediaByMsgId.get(m.messageId) ?? [];
      arr.push(m);
      mediaByMsgId.set(m.messageId, arr);
    }

    // Query all attachments for this chat (for history context — but we don't re-load base64 from disk for history)
    // Attachments in history are noted as text annotations; only the current message sends actual base64

    // Create annotated history for LLM context (not persisted)
    const annotatedHistory = history.map((m) => {
      const msgMedia = mediaByMsgId.get(m.id);
      if (!msgMedia?.length || m.role !== 'assistant') return m;
      const annotations = msgMedia
        .map((med) => `[Generated Image | id: ${med.id} | description: "${med.shortDescription}"]`)
        .join('\n');
      return { ...m, content: m.content + '\n\n' + annotations };
    });

    const settings = await getDecryptedSettings();
    const systemInstruction = await buildCombinedPrompt();
    const sysInstr = await getSystemInstruction();
    const braveApiKey = settings.tools?.braveSearch?.enabled && settings.tools.braveSearch.apiKey
      ? settings.tools.braveSearch.apiKey
      : undefined;

    // SSE headers
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    });

    const assistantMsgId = nanoid();
    let fullContent = '';
    let collectedCitations: { url: string; title: string }[] = [];

    // Pre-insert the assistant message so that media FK references are valid during streaming
    db.insert(messages)
      .values({
        id: assistantMsgId,
        chatId: chat.id,
        role: 'assistant',
        content: '',
        createdAt: new Date(),
      })
      .run();

    const sendEvent = (event: string, data: unknown) => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const collectedMediaIds: string[] = [];
    const onImageGenerated = (mediaInfo: MediaInfo) => {
      collectedMediaIds.push(mediaInfo.mediaId);
      sendEvent('image', mediaInfo);
    };

    const toolCallbacks = sysInstr.memoryEnabled
      ? createAIToolCallbacks({
          braveApiKey,
          chatId: chat.id,
          messageId: assistantMsgId,
          settings,
          onImageGenerated,
        })
      : null;

    sendEvent('start', { messageId: assistantMsgId, userMessageId: userMsgId });

    const onChunk = (text: string) => {
      fullContent += text;
      sendEvent('chunk', { text });
    };

    const onCitations = (citations: { url: string; title: string }[]) => {
      collectedCitations = citations;
    };

    const onDone = () => {
      // Strip JSON wrapping if the model output a JSON object instead of plain text
      let cleanContent = stripJsonWrapper(fullContent);

      // Update the pre-inserted assistant message with final content and citations
      db.update(messages)
        .set({
          content: cleanContent,
          citations: collectedCitations.length > 0 ? JSON.stringify(collectedCitations) : null,
        })
        .where(eq(messages.id, assistantMsgId))
        .run();
      sendEvent('done', {
        messageId: assistantMsgId,
        citations: collectedCitations.length > 0 ? collectedCitations : undefined,
        mediaIds: collectedMediaIds.length > 0 ? collectedMediaIds : undefined,
      });
      reply.raw.end();
    };

    const onError = (err: Error) => {
      console.error('[stream error]', err);
      // Clean up the pre-inserted empty assistant message on error
      if (!fullContent) {
        db.delete(messages).where(eq(messages.id, assistantMsgId)).run();
      } else {
        // Partial content — save what we have
        db.update(messages)
          .set({ content: fullContent })
          .where(eq(messages.id, assistantMsgId))
          .run();
      }
      sendEvent('error', { message: err.message });
      reply.raw.end();
    };

    // Determine provider from model id
    const provider = activeModel.startsWith('gemini') ? 'gemini' : 'openai';
    const apiKey = settings.apiKeys[provider].apiKey;
    const thinkingLevel = getThinkingLevelForModel(settings, activeModel);

    if (!apiKey) {
      onError(new Error(`${provider === 'gemini' ? 'Gemini' : 'OpenAI'} API key not configured`));
      return;
    }

    if (provider === 'gemini') {
      const geminiHistory: GeminiMessage[] = annotatedHistory.map((m) => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.content }],
      }));

      streamGeminiChat({
        apiKey,
        model: activeModel,
        thinkingLevel: thinkingLevel.toUpperCase() as 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH',
        history: geminiHistory,
        userMessage: userContent ?? '',
        attachments: savedAttachments.length > 0 ? savedAttachments : undefined,
        systemInstruction,
        toolCallbacks,
        onChunk,
        onCitations,
        onDone,
        onError,
      });
    } else {
      const openAIMessages: OpenAIMessage[] = annotatedHistory.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));
      openAIMessages.push({ role: 'user', content: userContent ?? '' });

      streamOpenAIChat({
        apiKey,
        model: activeModel,
        reasoningEffort: thinkingLevel as 'minimal' | 'low' | 'medium' | 'high',
        messages: openAIMessages,
        attachments: savedAttachments.length > 0 ? savedAttachments : undefined,
        systemInstruction,
        toolCallbacks,
        onChunk,
        onCitations,
        onDone,
        onError,
      });
    }
  });
}

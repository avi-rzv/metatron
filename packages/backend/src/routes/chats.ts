import type { FastifyInstance } from 'fastify';
import { chatsCol, messagesCol, mediaCol, attachmentsCol } from '../db/index.js';
import { toApiDoc, toApiDocs } from '../db/utils.js';
import { deleteChat } from '../db/cascade.js';
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
    const docs = await chatsCol.find().sort({ updatedAt: -1 }).toArray();
    return toApiDocs(docs);
  });

  // POST /api/chats — create new chat
  fastify.post<{
    Body: { title?: string; provider: string; model: string };
  }>('/api/chats', async (req) => {
    const now = new Date();
    const chat = {
      _id: nanoid(),
      title: req.body.title ?? 'New Chat',
      provider: req.body.provider,
      model: req.body.model,
      createdAt: now,
      updatedAt: now,
    };
    await chatsCol.insertOne(chat);
    return toApiDoc(chat);
  });

  // GET /api/chats/:id
  fastify.get<{ Params: { id: string } }>('/api/chats/:id', async (req, reply) => {
    const chat = await chatsCol.findOne({ _id: req.params.id });
    if (!chat) {
      reply.status(404).send({ error: 'Chat not found' });
      return;
    }
    const msgs = await messagesCol.find({ chatId: req.params.id }).sort({ createdAt: 1 }).toArray();
    const allMedia = await mediaCol.find({ chatId: req.params.id }).toArray();
    const mediaByMessage = new Map<string, typeof allMedia>();
    for (const m of allMedia) {
      const arr = mediaByMessage.get(m.messageId) ?? [];
      arr.push(m);
      mediaByMessage.set(m.messageId, arr);
    }
    const allAttachments = await attachmentsCol.find({ chatId: req.params.id }).toArray();
    const attachmentsByMessage = new Map<string, typeof allAttachments>();
    for (const a of allAttachments) {
      const arr = attachmentsByMessage.get(a.messageId) ?? [];
      arr.push(a);
      attachmentsByMessage.set(a.messageId, arr);
    }
    const enrichedMsgs = msgs.map((m) => ({
      ...toApiDoc(m),
      citations: m.citations ?? null,
      media: toApiDocs(mediaByMessage.get(m._id) ?? []),
      attachments: toApiDocs(attachmentsByMessage.get(m._id) ?? []),
    }));
    return { ...toApiDoc(chat), messages: enrichedMsgs };
  });

  // DELETE /api/chats/:id
  fastify.delete<{ Params: { id: string } }>('/api/chats/:id', async (req, reply) => {
    await deleteChat(req.params.id);
    reply.status(204).send();
  });

  // PATCH /api/chats/:id — update title
  fastify.patch<{ Params: { id: string }; Body: { title: string } }>(
    '/api/chats/:id',
    async (req) => {
      await chatsCol.updateOne(
        { _id: req.params.id },
        { $set: { title: req.body.title, updatedAt: new Date() } }
      );
      const updated = await chatsCol.findOne({ _id: req.params.id });
      return updated ? toApiDoc(updated) : null;
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
    const chat = await chatsCol.findOne({ _id: req.params.id });
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
    await messagesCol.insertOne({
      _id: userMsgId,
      chatId: chat._id,
      role: 'user',
      content: userContent ?? '',
      citations: null,
      createdAt: now,
    });

    // Save attachments to disk and DB
    const savedAttachments: Array<{ mimeType: string; data: string; name: string }> = [];
    for (const att of incomingAttachments) {
      const ext = extname(att.name) || '.bin';
      const filename = nanoid() + ext;
      const filepath = join('./data/uploads', filename);
      const buffer = Buffer.from(att.data, 'base64');
      await writeFile(filepath, buffer);
      const attId = nanoid();
      await attachmentsCol.insertOne({
        _id: attId,
        chatId: chat._id,
        messageId: userMsgId,
        filename,
        originalName: att.name,
        mimeType: att.mimeType,
        size: buffer.length,
        createdAt: now,
      });
      savedAttachments.push({ mimeType: att.mimeType, data: att.data, name: att.name });
    }

    // Save voice audio as attachment if provided
    if (req.body.audio) {
      const audio = req.body.audio;
      const audioAttId = nanoid();
      await attachmentsCol.insertOne({
        _id: audioAttId,
        chatId: chat._id,
        messageId: userMsgId,
        filename: audio.filename,
        originalName: 'voice-message' + (audio.filename.substring(audio.filename.lastIndexOf('.')) || '.webm'),
        mimeType: audio.mimeType,
        size: audio.size,
        createdAt: now,
      });
    }

    // Auto-title the chat after first message
    const msgCount = await messagesCol.countDocuments({ chatId: chat._id });
    if (msgCount <= 1) {
      const title = userContent.slice(0, 60) + (userContent.length > 60 ? '...' : '');
      await chatsCol.updateOne({ _id: chat._id }, { $set: { title, updatedAt: new Date() } });
    } else {
      await chatsCol.updateOne({ _id: chat._id }, { $set: { updatedAt: new Date() } });
    }

    // Load conversation history
    const history = await messagesCol
      .find({ chatId: chat._id, _id: { $ne: userMsgId } })
      .sort({ createdAt: 1 })
      .toArray();

    // Query all media for this chat and group by messageId
    const allMedia = await mediaCol.find({ chatId: chat._id }).toArray();
    const mediaByMsgId = new Map<string, typeof allMedia>();
    for (const m of allMedia) {
      const arr = mediaByMsgId.get(m.messageId) ?? [];
      arr.push(m);
      mediaByMsgId.set(m.messageId, arr);
    }

    // Create annotated history for LLM context (not persisted)
    const annotatedHistory = history.map((m) => {
      const msgMedia = mediaByMsgId.get(m._id);
      if (!msgMedia?.length || m.role !== 'assistant') return m;
      const annotations = msgMedia
        .map((med) => `[Generated Image | id: ${med._id} | description: "${med.shortDescription}"]`)
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
    await messagesCol.insertOne({
      _id: assistantMsgId,
      chatId: chat._id,
      role: 'assistant',
      content: '',
      citations: null,
      createdAt: new Date(),
    });

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
          chatId: chat._id,
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

    const onDone = async () => {
      // Strip JSON wrapping if the model output a JSON object instead of plain text
      let cleanContent = stripJsonWrapper(fullContent);

      // Update the pre-inserted assistant message with final content and citations
      await messagesCol.updateOne(
        { _id: assistantMsgId },
        { $set: {
          content: cleanContent,
          citations: collectedCitations.length > 0 ? collectedCitations : null,
        } }
      );
      sendEvent('done', {
        messageId: assistantMsgId,
        citations: collectedCitations.length > 0 ? collectedCitations : undefined,
        mediaIds: collectedMediaIds.length > 0 ? collectedMediaIds : undefined,
      });
      reply.raw.end();
    };

    const onError = async (err: Error) => {
      console.error('[stream error]', err);
      // Clean up the pre-inserted empty assistant message on error
      if (!fullContent) {
        await messagesCol.deleteOne({ _id: assistantMsgId });
      } else {
        // Partial content — save what we have
        await messagesCol.updateOne(
          { _id: assistantMsgId },
          { $set: { content: fullContent } }
        );
      }
      sendEvent('error', { message: err.message });
      reply.raw.end();
    };

    // Determine provider from model id
    const provider = activeModel.startsWith('gemini') ? 'gemini' : 'openai';
    const apiKey = settings.apiKeys[provider].apiKey;
    const thinkingLevel = getThinkingLevelForModel(settings, activeModel);

    if (!apiKey) {
      await onError(new Error(`${provider === 'gemini' ? 'Gemini' : 'OpenAI'} API key not configured`));
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

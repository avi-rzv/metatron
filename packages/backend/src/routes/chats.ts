import type { FastifyInstance } from 'fastify';
import { db } from '../db/index.js';
import { chats, messages } from '../db/schema.js';
import { eq, desc } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { getDecryptedSettings } from '../services/settings.js';
import { streamGeminiChat, type GeminiMessage } from '../services/llm/gemini.js';
import { streamOpenAIChat, type OpenAIMessage } from '../services/llm/openai.js';

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
    return { ...chat, messages: msgs };
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
    Body: { content: string };
  }>('/api/chats/:id/stream', async (req, reply) => {
    const chat = db.select().from(chats).where(eq(chats.id, req.params.id)).get();
    if (!chat) {
      reply.status(404).send({ error: 'Chat not found' });
      return;
    }

    const userContent = req.body.content?.trim();
    if (!userContent) {
      reply.status(400).send({ error: 'Content is required' });
      return;
    }

    // Save user message
    const userMsgId = nanoid();
    const now = new Date();
    db.insert(messages)
      .values({ id: userMsgId, chatId: chat.id, role: 'user', content: userContent, createdAt: now })
      .run();

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

    const settings = await getDecryptedSettings();

    // SSE headers
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    });

    const assistantMsgId = nanoid();
    let fullContent = '';

    const sendEvent = (event: string, data: unknown) => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    sendEvent('start', { messageId: assistantMsgId, userMessageId: userMsgId });

    const onChunk = (text: string) => {
      fullContent += text;
      sendEvent('chunk', { text });
    };

    const onDone = () => {
      // Save assistant message
      db.insert(messages)
        .values({
          id: assistantMsgId,
          chatId: chat.id,
          role: 'assistant',
          content: fullContent,
          createdAt: new Date(),
        })
        .run();
      sendEvent('done', { messageId: assistantMsgId });
      reply.raw.end();
    };

    const onError = (err: Error) => {
      sendEvent('error', { message: err.message });
      reply.raw.end();
    };

    if (chat.provider === 'gemini') {
      if (!settings.gemini.apiKey) {
        onError(new Error('Gemini API key not configured'));
        return;
      }

      const geminiHistory: GeminiMessage[] = history.map((m) => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.content }],
      }));

      streamGeminiChat({
        apiKey: settings.gemini.apiKey,
        model: chat.model,
        thinkingLevel: settings.gemini.thinkingLevel,
        history: geminiHistory,
        userMessage: userContent,
        onChunk,
        onDone,
        onError,
      });
    } else {
      if (!settings.openai.apiKey) {
        onError(new Error('OpenAI API key not configured'));
        return;
      }

      const openAIMessages: OpenAIMessage[] = history.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));
      openAIMessages.push({ role: 'user', content: userContent });

      streamOpenAIChat({
        apiKey: settings.openai.apiKey,
        model: chat.model,
        reasoningEffort: settings.openai.reasoningEffort,
        messages: openAIMessages,
        onChunk,
        onDone,
        onError,
      });
    }
  });
}

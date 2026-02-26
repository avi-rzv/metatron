import type { FastifyInstance } from 'fastify';
import { whatsapp } from '../services/whatsapp.js';

export async function whatsappRoutes(fastify: FastifyInstance) {
  // GET /api/whatsapp/status
  fastify.get('/api/whatsapp/status', async () => {
    return {
      status: whatsapp.status,
      phoneNumber: whatsapp.phoneNumber,
    };
  });

  // POST /api/whatsapp/connect
  fastify.post('/api/whatsapp/connect', async (_req, reply) => {
    if (whatsapp.status === 'connected') {
      return { status: 'already_connected', phoneNumber: whatsapp.phoneNumber };
    }
    // Fire-and-forget — the client will poll status or use SSE for QR
    whatsapp.connect().catch((err) => {
      console.error('[WhatsApp] connect error:', err);
    });
    return { status: 'connecting' };
  });

  // GET /api/whatsapp/qr — current QR as base64 data URL
  fastify.get('/api/whatsapp/qr', async (_req, reply) => {
    const qr = whatsapp.qrDataUrl;
    if (!qr) {
      reply.status(404).send({ error: 'No QR code available' });
      return;
    }
    return { qr };
  });

  // GET /api/whatsapp/qr/stream — SSE stream for real-time QR updates
  fastify.get('/api/whatsapp/qr/stream', async (req, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const sendEvent = (event: string, data: unknown) => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // Send current state immediately
    sendEvent('status', { status: whatsapp.status, phoneNumber: whatsapp.phoneNumber });
    if (whatsapp.qrDataUrl) {
      sendEvent('qr', { qr: whatsapp.qrDataUrl });
    }

    const onQr = (qr: string) => sendEvent('qr', { qr });
    const onStatus = (status: string) => {
      sendEvent('status', { status, phoneNumber: whatsapp.phoneNumber });
    };
    const onConnected = (phone: string | null) => {
      sendEvent('connected', { phoneNumber: phone });
    };

    whatsapp.on('qr', onQr);
    whatsapp.on('status', onStatus);
    whatsapp.on('connected', onConnected);

    // Keep-alive ping every 30s
    const keepAlive = setInterval(() => {
      reply.raw.write(': keep-alive\n\n');
    }, 30_000);

    req.raw.on('close', () => {
      whatsapp.off('qr', onQr);
      whatsapp.off('status', onStatus);
      whatsapp.off('connected', onConnected);
      clearInterval(keepAlive);
    });
  });

  // POST /api/whatsapp/disconnect
  fastify.post<{ Body: { clearSession?: boolean } }>('/api/whatsapp/disconnect', async (req) => {
    const clearSession = req.body?.clearSession ?? false;
    await whatsapp.disconnect(clearSession);
    return { status: 'disconnected' };
  });

  // GET /api/whatsapp/messages
  fastify.get<{ Querystring: { contact?: string; limit?: string } }>('/api/whatsapp/messages', async (req) => {
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const messages = whatsapp.getMessages(req.query.contact, limit);
    return { messages };
  });
}

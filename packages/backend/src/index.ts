import './env.js'; // Must be first — loads .env into process.env before anything else

import Fastify from 'fastify';
import cors from '@fastify/cors';
import staticPlugin from '@fastify/static';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { chatRoutes } from './routes/chats.js';
import { settingsRoutes } from './routes/settings.js';
import { systemInstructionRoutes } from './routes/systemInstruction.js';
import { mediaRoutes } from './routes/media.js';
import { uploadRoutes } from './routes/uploads.js';
import { voiceRoutes } from './routes/voice.js';
import { whatsappRoutes } from './routes/whatsapp.js';
import { whatsappPermissionRoutes } from './routes/whatsappPermissions.js';
import { whatsappGroupPermissionRoutes } from './routes/whatsappGroupPermissions.js';
import { cronjobRoutes } from './routes/cronjobs.js';
import { initWhatsAppAutoReply } from './services/whatsappAutoReply.js';
import { initCronService } from './services/cronService.js';
import { initPulseService } from './services/pulseService.js';
import multipart from '@fastify/multipart';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Treat as dev only when explicitly set — undefined means production on the server
const isDev = process.env.NODE_ENV === 'development';

const fastify = Fastify({
  logger: isDev
    ? { level: 'info' }
    : true,
  bodyLimit: 52_428_800, // 50 MB for base64 file uploads
});

await fastify.register(cors, {
  origin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:3000',
  credentials: true,
});

await fastify.register(multipart, {
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
});

// Routes
await fastify.register(chatRoutes);
await fastify.register(settingsRoutes);
await fastify.register(systemInstructionRoutes);
await fastify.register(mediaRoutes);
await fastify.register(uploadRoutes);
await fastify.register(voiceRoutes);
await fastify.register(whatsappRoutes);
await fastify.register(whatsappPermissionRoutes);
await fastify.register(whatsappGroupPermissionRoutes);
await fastify.register(cronjobRoutes);

// Initialize WhatsApp auto-reply service
initWhatsAppAutoReply();

// Initialize cron service
await initCronService();

// Initialize pulse service
await initPulseService();

// Health check
fastify.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

// Serve frontend in production
if (!isDev) {
  const frontendDist = join(__dirname, '../../frontend/dist');
  await fastify.register(staticPlugin, {
    root: frontendDist,
    prefix: '/',
    wildcard: false,
  });
  // SPA fallback — serve index.html for all unmatched routes (React Router)
  fastify.setNotFoundHandler((_req, reply) => {
    reply.sendFile('index.html', frontendDist);
  });
}

const PORT = Number(process.env.PORT ?? 4000);
const HOST = process.env.HOST ?? '0.0.0.0';

try {
  await fastify.listen({ port: PORT, host: HOST });
  console.log(`Metatron backend running at http://${HOST}:${PORT}`);
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}

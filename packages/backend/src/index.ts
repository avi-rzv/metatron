import './env.js'; // Must be first — loads .env into process.env before anything else

import Fastify from 'fastify';
import cors from '@fastify/cors';
import staticPlugin from '@fastify/static';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { chatRoutes } from './routes/chats.js';
import { settingsRoutes } from './routes/settings.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Treat as dev only when explicitly set — undefined means production on the server
const isDev = process.env.NODE_ENV === 'development';

const fastify = Fastify({
  logger: isDev
    ? { level: 'info' }
    : true,
});

await fastify.register(cors, {
  origin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:3000',
  credentials: true,
});

// Routes
await fastify.register(chatRoutes);
await fastify.register(settingsRoutes);

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

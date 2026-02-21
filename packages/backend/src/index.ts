import Fastify from 'fastify';
import cors from '@fastify/cors';
import { chatRoutes } from './routes/chats.js';
import { settingsRoutes } from './routes/settings.js';

const isDev = process.env.NODE_ENV !== 'production';

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

const PORT = Number(process.env.PORT ?? 4000);
const HOST = process.env.HOST ?? '0.0.0.0';

try {
  await fastify.listen({ port: PORT, host: HOST });
  console.log(`Metatron backend running at http://${HOST}:${PORT}`);
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}

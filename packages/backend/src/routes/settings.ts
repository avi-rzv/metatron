import type { FastifyInstance } from 'fastify';
import { getDecryptedSettings, updateSettings } from '../services/settings.js';
import { maskApiKey } from '../services/encryption.js';

export async function settingsRoutes(fastify: FastifyInstance) {
  // GET /api/settings — returns settings with masked API keys
  fastify.get('/api/settings', async (_req, reply) => {
    const s = await getDecryptedSettings();
    return {
      gemini: {
        ...s.gemini,
        apiKey: s.gemini.apiKey ? maskApiKey(s.gemini.apiKey) : '',
        hasApiKey: !!s.gemini.apiKey,
      },
      openai: {
        ...s.openai,
        apiKey: s.openai.apiKey ? maskApiKey(s.openai.apiKey) : '',
        hasApiKey: !!s.openai.apiKey,
      },
    };
  });

  // GET /api/settings/keys — returns full decrypted API keys for display
  fastify.get('/api/settings/keys', async (_req, reply) => {
    const s = await getDecryptedSettings();
    return {
      gemini: s.gemini.apiKey,
      openai: s.openai.apiKey,
    };
  });

  // PUT /api/settings — update settings
  fastify.put<{ Body: { gemini?: Record<string, string>; openai?: Record<string, string> } }>(
    '/api/settings',
    async (req, reply) => {
      const updated = await updateSettings(req.body as Parameters<typeof updateSettings>[0]);
      return {
        gemini: {
          ...updated.gemini,
          apiKey: updated.gemini.apiKey ? maskApiKey(updated.gemini.apiKey) : '',
          hasApiKey: !!updated.gemini.apiKey,
        },
        openai: {
          ...updated.openai,
          apiKey: updated.openai.apiKey ? maskApiKey(updated.openai.apiKey) : '',
          hasApiKey: !!updated.openai.apiKey,
        },
      };
    }
  );
}

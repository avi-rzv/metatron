import type { FastifyInstance } from 'fastify';
import { getDecryptedSettings, updateSettings, type AppSettings } from '../services/settings.js';
import { maskApiKey } from '../services/encryption.js';

export async function settingsRoutes(fastify: FastifyInstance) {
  // GET /api/settings — returns settings with masked API keys
  fastify.get('/api/settings', async (_req, reply) => {
    const s = await getDecryptedSettings();
    return {
      primaryModel: s.primaryModel,
      fallbackModels: s.fallbackModels,
      primaryImageModel: s.primaryImageModel,
      fallbackImageModels: s.fallbackImageModels,
      apiKeys: {
        gemini: {
          apiKey: s.apiKeys.gemini.apiKey ? maskApiKey(s.apiKeys.gemini.apiKey) : '',
          hasApiKey: !!s.apiKeys.gemini.apiKey,
        },
        openai: {
          apiKey: s.apiKeys.openai.apiKey ? maskApiKey(s.apiKeys.openai.apiKey) : '',
          hasApiKey: !!s.apiKeys.openai.apiKey,
        },
      },
      timezone: s.timezone,
      tools: {
        braveSearch: {
          enabled: s.tools?.braveSearch?.enabled ?? false,
          apiKey: s.tools?.braveSearch?.apiKey ? maskApiKey(s.tools.braveSearch.apiKey) : '',
          hasApiKey: !!s.tools?.braveSearch?.apiKey,
        },
      },
    };
  });

  // GET /api/settings/keys — returns full decrypted API keys for display
  fastify.get('/api/settings/keys', async (_req, reply) => {
    const s = await getDecryptedSettings();
    return {
      gemini: s.apiKeys.gemini.apiKey,
      openai: s.apiKeys.openai.apiKey,
      braveSearch: s.tools?.braveSearch?.apiKey ?? '',
    };
  });

  // PUT /api/settings — update settings
  fastify.put<{ Body: Partial<AppSettings> }>(
    '/api/settings',
    async (req, reply) => {
      const updated = await updateSettings(req.body);
      return {
        primaryModel: updated.primaryModel,
        fallbackModels: updated.fallbackModels,
        primaryImageModel: updated.primaryImageModel,
        fallbackImageModels: updated.fallbackImageModels,
        apiKeys: {
          gemini: {
            apiKey: updated.apiKeys.gemini.apiKey ? maskApiKey(updated.apiKeys.gemini.apiKey) : '',
            hasApiKey: !!updated.apiKeys.gemini.apiKey,
          },
          openai: {
            apiKey: updated.apiKeys.openai.apiKey ? maskApiKey(updated.apiKeys.openai.apiKey) : '',
            hasApiKey: !!updated.apiKeys.openai.apiKey,
          },
        },
        timezone: updated.timezone,
        tools: {
          braveSearch: {
            enabled: updated.tools?.braveSearch?.enabled ?? false,
            apiKey: updated.tools?.braveSearch?.apiKey ? maskApiKey(updated.tools.braveSearch.apiKey) : '',
            hasApiKey: !!updated.tools?.braveSearch?.apiKey,
          },
        },
      };
    }
  );
}

import { db } from '../db/index.js';
import { settings } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { encrypt, decrypt } from './encryption.js';

export interface GeminiSettings {
  apiKey: string;
  defaultModel: string;
  thinkingLevel: 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH';
  imageModel: string;
}

export interface OpenAISettings {
  apiKey: string;
  defaultModel: string;
  reasoningEffort: 'minimal' | 'low' | 'medium' | 'high';
  imageModel: string;
}

export interface AppSettings {
  gemini: GeminiSettings;
  openai: OpenAISettings;
}

const DEFAULTS: AppSettings = {
  gemini: {
    apiKey: '',
    defaultModel: 'gemini-3-pro-preview',
    thinkingLevel: 'MEDIUM',
    imageModel: 'gemini-3-pro-image-preview',
  },
  openai: {
    apiKey: '',
    defaultModel: 'gpt-5.2',
    reasoningEffort: 'medium',
    imageModel: 'gpt-image-1',
  },
};

async function getSetting(key: string): Promise<string | null> {
  const row = db.select().from(settings).where(eq(settings.key, key)).get();
  return row?.value ?? null;
}

async function setSetting(key: string, value: string): Promise<void> {
  db.insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
    .run();
}

export async function getSettings(): Promise<AppSettings> {
  const raw = await getSetting('app_settings');
  if (!raw) return structuredClone(DEFAULTS);

  try {
    return JSON.parse(raw) as AppSettings;
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export async function updateSettings(partial: Partial<AppSettings>): Promise<AppSettings> {
  const current = await getSettings();

  // Only overwrite the API key if a new non-empty key is provided.
  // Sending an empty apiKey means "don't change the existing key".
  const geminiPartial = { ...partial.gemini };
  const openaiPartial = { ...partial.openai };
  if (!geminiPartial.apiKey) delete geminiPartial.apiKey;
  if (!openaiPartial.apiKey) delete openaiPartial.apiKey;

  const updated: AppSettings = {
    gemini: { ...current.gemini, ...geminiPartial },
    openai: { ...current.openai, ...openaiPartial },
  };

  // Encrypt only newly provided keys; preserved keys are already encrypted in `current`.
  const toStore = structuredClone(updated);
  if (partial.gemini?.apiKey) {
    toStore.gemini.apiKey = encrypt(partial.gemini.apiKey);
  }
  if (partial.openai?.apiKey) {
    toStore.openai.apiKey = encrypt(partial.openai.apiKey);
  }

  await setSetting('app_settings', JSON.stringify(toStore));
  return updated;
}

export async function getDecryptedSettings(): Promise<AppSettings> {
  const raw = await getSetting('app_settings');
  if (!raw) return structuredClone(DEFAULTS);

  try {
    const parsed = JSON.parse(raw) as AppSettings;
    // Decrypt API keys
    if (parsed.gemini.apiKey) {
      try { parsed.gemini.apiKey = decrypt(parsed.gemini.apiKey); } catch { parsed.gemini.apiKey = ''; }
    }
    if (parsed.openai.apiKey) {
      try { parsed.openai.apiKey = decrypt(parsed.openai.apiKey); } catch { parsed.openai.apiKey = ''; }
    }
    return parsed;
  } catch {
    return structuredClone(DEFAULTS);
  }
}

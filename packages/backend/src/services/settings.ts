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
  const updated: AppSettings = {
    gemini: { ...current.gemini, ...(partial.gemini ?? {}) },
    openai: { ...current.openai, ...(partial.openai ?? {}) },
  };

  // Encrypt API keys before storing
  const toStore = structuredClone(updated);
  if (toStore.gemini.apiKey) {
    toStore.gemini.apiKey = encrypt(toStore.gemini.apiKey);
  }
  if (toStore.openai.apiKey) {
    toStore.openai.apiKey = encrypt(toStore.openai.apiKey);
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

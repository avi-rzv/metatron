import { settingsCol } from '../db/index.js';
import { encrypt, decrypt } from './encryption.js';

export type ThinkingLevel = 'minimal' | 'low' | 'medium' | 'high';

export interface ModelWithThinking {
  modelId: string;
  thinkingLevel: ThinkingLevel;
}

export interface ProviderKeys {
  apiKey: string;
}

export interface ToolSettings {
  braveSearch: { enabled: boolean; apiKey: string };
}

export interface QuietHoursRange {
  start: string;  // "HH:mm" 24h format
  end: string;    // "HH:mm" 24h format
}

export type PulseInterval = 48 | 24 | 12 | 6 | 2;

export interface PulseSettings {
  enabled: boolean;
  activeDays: number[];          // 0=Sun..6=Sat
  pulsesPerDay: PulseInterval;   // 48, 24, 12, 6, or 2
  quietHours: QuietHoursRange[];
  chatId: string | null;         // dedicated pulse chat (created on first pulse)
  notes: string;                 // AI-maintained continuity notes (max 2000 chars)
  lastPulseAt: string | null;    // ISO string
  pulsesToday: number;           // reset at midnight in user's timezone
  todayDate: string | null;      // "YYYY-MM-DD" for day-boundary detection
}

export interface AppSettings {
  primaryModel: ModelWithThinking;
  fallbackModels: ModelWithThinking[];
  primaryImageModel: string;
  fallbackImageModels: string[];
  apiKeys: {
    gemini: ProviderKeys;
    openai: ProviderKeys;
  };
  timezone: string;
  tools: ToolSettings;
  pulse: PulseSettings;
}

const DEFAULTS: AppSettings = {
  primaryModel: { modelId: 'gemini-3.1-pro-preview', thinkingLevel: 'medium' },
  fallbackModels: [],
  primaryImageModel: 'gemini-3-pro-image-preview',
  fallbackImageModels: [],
  apiKeys: { gemini: { apiKey: '' }, openai: { apiKey: '' } },
  timezone: 'UTC',
  tools: { braveSearch: { enabled: false, apiKey: '' } },
  pulse: {
    enabled: false,
    activeDays: [0, 1, 2, 3, 4, 5, 6],
    pulsesPerDay: 12 as PulseInterval,
    quietHours: [],
    chatId: null,
    notes: '',
    lastPulseAt: null,
    pulsesToday: 0,
    todayDate: null,
  },
};

// Old format types for migration detection
interface OldGeminiSettings {
  apiKey: string;
  defaultModel: string;
  thinkingLevel: 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH';
  imageModel: string;
}

interface OldOpenAISettings {
  apiKey: string;
  defaultModel: string;
  reasoningEffort: 'minimal' | 'low' | 'medium' | 'high';
  imageModel: string;
}

interface OldAppSettings {
  gemini: OldGeminiSettings;
  openai: OldOpenAISettings;
  timezone: string;
}

function isOldFormat(parsed: any): parsed is OldAppSettings {
  return parsed.gemini?.defaultModel !== undefined && parsed.primaryModel === undefined;
}

function migrateOldToNew(old: OldAppSettings): AppSettings {
  const fallbackModels: ModelWithThinking[] = [];
  const fallbackImageModels: string[] = [];

  // OpenAI model becomes first fallback if it exists
  if (old.openai.defaultModel) {
    fallbackModels.push({
      modelId: old.openai.defaultModel,
      thinkingLevel: old.openai.reasoningEffort ?? 'medium',
    });
  }

  // OpenAI image model becomes fallback
  if (old.openai.imageModel) {
    fallbackImageModels.push(old.openai.imageModel);
  }

  return {
    primaryModel: {
      modelId: old.gemini.defaultModel,
      thinkingLevel: (old.gemini.thinkingLevel?.toLowerCase() ?? 'medium') as ThinkingLevel,
    },
    fallbackModels,
    primaryImageModel: old.gemini.imageModel || 'gemini-3-pro-image-preview',
    fallbackImageModels,
    apiKeys: {
      gemini: { apiKey: old.gemini.apiKey || '' },
      openai: { apiKey: old.openai.apiKey || '' },
    },
    timezone: old.timezone || 'UTC',
    tools: { braveSearch: { enabled: false, apiKey: '' } },
    pulse: structuredClone(DEFAULTS.pulse),
  };
}

async function getSetting(key: string): Promise<string | null> {
  const row = await settingsCol.findOne({ _id: key });
  return row?.value ?? null;
}

async function setSetting(key: string, value: string): Promise<void> {
  await settingsCol.updateOne({ _id: key }, { $set: { value } }, { upsert: true });
}

export async function getSettings(): Promise<AppSettings> {
  const raw = await getSetting('app_settings');
  if (!raw) return structuredClone(DEFAULTS);

  try {
    const parsed = JSON.parse(raw);
    if (isOldFormat(parsed)) {
      // Migrate and persist
      const migrated = migrateOldToNew(parsed);
      // Preserve encrypted API keys as-is during migration
      const toStore = structuredClone(migrated);
      toStore.apiKeys.gemini.apiKey = parsed.gemini.apiKey || '';
      toStore.apiKeys.openai.apiKey = parsed.openai.apiKey || '';
      await setSetting('app_settings', JSON.stringify(toStore));
      return toStore;
    }
    const result = parsed as AppSettings;
    if (!result.tools) {
      result.tools = structuredClone(DEFAULTS.tools);
    }
    if (!result.pulse) {
      result.pulse = structuredClone(DEFAULTS.pulse);
    }
    return result;
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export async function updateSettings(partial: Partial<AppSettings>): Promise<AppSettings> {
  const current = await getSettings();

  const currentTools = current.tools ?? DEFAULTS.tools;
  const currentPulse = current.pulse ?? DEFAULTS.pulse;

  const updated: AppSettings = {
    primaryModel: partial.primaryModel ?? current.primaryModel,
    fallbackModels: partial.fallbackModels ?? current.fallbackModels,
    primaryImageModel: partial.primaryImageModel ?? current.primaryImageModel,
    fallbackImageModels: partial.fallbackImageModels ?? current.fallbackImageModels,
    apiKeys: {
      gemini: { apiKey: current.apiKeys.gemini.apiKey },
      openai: { apiKey: current.apiKeys.openai.apiKey },
    },
    timezone: partial.timezone ?? current.timezone,
    tools: {
      braveSearch: {
        enabled: partial.tools?.braveSearch?.enabled ?? currentTools.braveSearch.enabled,
        apiKey: currentTools.braveSearch.apiKey,
      },
    },
    pulse: {
      enabled: partial.pulse?.enabled ?? currentPulse.enabled,
      activeDays: partial.pulse?.activeDays ?? currentPulse.activeDays,
      pulsesPerDay: partial.pulse?.pulsesPerDay ?? currentPulse.pulsesPerDay,
      quietHours: partial.pulse?.quietHours ?? currentPulse.quietHours,
      chatId: partial.pulse?.chatId !== undefined ? partial.pulse.chatId : currentPulse.chatId,
      notes: partial.pulse?.notes !== undefined ? partial.pulse.notes : currentPulse.notes,
      lastPulseAt: partial.pulse?.lastPulseAt !== undefined ? partial.pulse.lastPulseAt : currentPulse.lastPulseAt,
      pulsesToday: partial.pulse?.pulsesToday !== undefined ? partial.pulse.pulsesToday : currentPulse.pulsesToday,
      todayDate: partial.pulse?.todayDate !== undefined ? partial.pulse.todayDate : currentPulse.todayDate,
    },
  };

  // Encrypt only newly provided keys; preserved keys are already encrypted in `current`.
  const toStore = structuredClone(updated);
  if (partial.apiKeys?.gemini?.apiKey) {
    toStore.apiKeys.gemini.apiKey = encrypt(partial.apiKeys.gemini.apiKey);
  }
  if (partial.apiKeys?.openai?.apiKey) {
    toStore.apiKeys.openai.apiKey = encrypt(partial.apiKeys.openai.apiKey);
  }

  // Brave Search API key: encrypt new key, preserve existing, or clear
  const newBraveKey = partial.tools?.braveSearch?.apiKey;
  if (newBraveKey !== undefined) {
    if (newBraveKey) {
      toStore.tools.braveSearch.apiKey = encrypt(newBraveKey);
    } else {
      // Empty string = remove key
      toStore.tools.braveSearch.apiKey = '';
    }
  }

  await setSetting('app_settings', JSON.stringify(toStore));
  return getDecryptedSettings();
}

export async function getDecryptedSettings(): Promise<AppSettings> {
  const raw = await getSetting('app_settings');
  if (!raw) return structuredClone(DEFAULTS);

  try {
    let parsed = JSON.parse(raw);
    // Handle old format transparently
    if (isOldFormat(parsed)) {
      const migrated = migrateOldToNew(parsed);
      // Decrypt keys from old positions
      if (parsed.gemini.apiKey) {
        try { migrated.apiKeys.gemini.apiKey = decrypt(parsed.gemini.apiKey); } catch { migrated.apiKeys.gemini.apiKey = ''; }
      }
      if (parsed.openai.apiKey) {
        try { migrated.apiKeys.openai.apiKey = decrypt(parsed.openai.apiKey); } catch { migrated.apiKeys.openai.apiKey = ''; }
      }
      return migrated;
    }

    parsed = parsed as AppSettings;
    // Ensure tools defaults exist for older stored settings
    if (!parsed.tools) {
      parsed.tools = structuredClone(DEFAULTS.tools);
    }
    if (!parsed.pulse) {
      parsed.pulse = structuredClone(DEFAULTS.pulse);
    }
    // Decrypt API keys
    if (parsed.apiKeys?.gemini?.apiKey) {
      try { parsed.apiKeys.gemini.apiKey = decrypt(parsed.apiKeys.gemini.apiKey); } catch { parsed.apiKeys.gemini.apiKey = ''; }
    }
    if (parsed.apiKeys?.openai?.apiKey) {
      try { parsed.apiKeys.openai.apiKey = decrypt(parsed.apiKeys.openai.apiKey); } catch { parsed.apiKeys.openai.apiKey = ''; }
    }
    if (parsed.tools?.braveSearch?.apiKey) {
      try { parsed.tools.braveSearch.apiKey = decrypt(parsed.tools.braveSearch.apiKey); } catch { parsed.tools.braveSearch.apiKey = ''; }
    }
    return parsed;
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export function getThinkingLevelForModel(settings: AppSettings, modelId: string): string {
  if (settings.primaryModel.modelId === modelId) return settings.primaryModel.thinkingLevel;
  const fb = settings.fallbackModels.find(f => f.modelId === modelId);
  return fb?.thinkingLevel ?? settings.primaryModel.thinkingLevel;
}

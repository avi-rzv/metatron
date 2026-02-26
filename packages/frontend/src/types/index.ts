export interface Citation {
  url: string;
  title: string;
}

export interface Media {
  id: string;
  chatId: string;
  messageId: string;
  filename: string;
  prompt: string;
  shortDescription: string;
  mimeType: string;
  size: number;
  model: string;
  sourceMediaId?: string;
  createdAt: string;
}

export interface Attachment {
  id: string;
  chatId: string;
  messageId: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

export interface Message {
  id: string;
  chatId: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[] | null;
  media?: Media[];
  attachments?: Attachment[];
  localAudioUrl?: string;
  createdAt: string;
}

export interface Chat {
  id: string;
  title: string;
  provider: 'gemini' | 'openai';
  model: string;
  createdAt: string;
  updatedAt: string;
  messages?: Message[];
}

export type Provider = 'gemini' | 'openai';

export type ThinkingLevel = 'minimal' | 'low' | 'medium' | 'high';

export interface ModelDefinition {
  id: string;
  label: string;
  provider: Provider;
}

export const ALL_MODELS: ModelDefinition[] = [
  { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro', provider: 'gemini' },
  { id: 'gemini-3-pro-preview', label: 'Gemini 3.0 Pro', provider: 'gemini' },
  { id: 'gemini-3-flash-preview', label: 'Gemini 3.0 Flash', provider: 'gemini' },
  { id: 'gpt-5.2', label: 'GPT 5.2', provider: 'openai' },
  { id: 'gpt-5-mini', label: 'GPT 5-Mini', provider: 'openai' },
  { id: 'gpt-5-nano', label: 'GPT 5-Nano', provider: 'openai' },
];

export const ALL_IMAGE_MODELS: ModelDefinition[] = [
  { id: 'gemini-3-pro-image-preview', label: 'Nano Banana Pro', provider: 'gemini' },
  { id: 'gemini-2.5-flash-image', label: 'Nano Banana', provider: 'gemini' },
  { id: 'gpt-image-1', label: 'GPT Image 1', provider: 'openai' },
  { id: 'gpt-image-1-mini', label: 'GPT Image 1-Mini', provider: 'openai' },
  { id: 'gpt-image-1.5', label: 'GPT Image 1.5', provider: 'openai' },
];

export function getProviderForModel(modelId: string): Provider | null {
  return [...ALL_MODELS, ...ALL_IMAGE_MODELS].find(m => m.id === modelId)?.provider ?? null;
}

// Derived arrays for backward compat (used by ModelSelector in ChatPage)
export const GEMINI_MODELS = ALL_MODELS.filter(m => m.provider === 'gemini');
export const OPENAI_MODELS = ALL_MODELS.filter(m => m.provider === 'openai');
export const GEMINI_IMAGE_MODELS = ALL_IMAGE_MODELS.filter(m => m.provider === 'gemini');
export const OPENAI_IMAGE_MODELS = ALL_IMAGE_MODELS.filter(m => m.provider === 'openai');

export interface ModelWithThinking {
  modelId: string;
  thinkingLevel: ThinkingLevel;
}

export interface ProviderKeys {
  apiKey?: string;
  hasApiKey?: boolean;
}

export interface ToolConfig {
  enabled: boolean;
  apiKey?: string;
  hasApiKey?: boolean;
}

export interface QuietHoursRange {
  start: string;
  end: string;
}

export type PulseInterval = 48 | 24 | 12 | 6 | 2;

export interface PulseSettings {
  enabled: boolean;
  activeDays: number[];
  pulsesPerDay: PulseInterval;
  quietHours: QuietHoursRange[];
  chatId: string | null;
  notes: string;
  lastPulseAt: string | null;
  pulsesToday: number;
  todayDate: string | null;
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
  tools: {
    braveSearch: ToolConfig;
  };
  pulse: PulseSettings;
}

export interface SystemInstruction {
  coreInstruction: string;
  memory: string;
  memoryEnabled: boolean;
  dbSchema: string;
  updatedAt: string;
}

export interface CronJob {
  id: string;
  name: string;
  instruction: string;
  cronExpression: string;
  timezone: string;
  enabled: boolean;
  chatId: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WhatsAppPermission {
  id: string;
  phoneNumber: string;
  displayName: string;
  contactId: string | null;
  canRead: boolean;
  canReply: boolean;
  chatInstructions: string | null;
  chatId: string | null;
  createdAt: string;
  updatedAt: string;
}

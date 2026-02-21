export interface Message {
  id: string;
  chatId: string;
  role: 'user' | 'assistant';
  content: string;
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

export interface GeminiSettings {
  apiKey?: string;
  hasApiKey?: boolean;
  defaultModel: string;
  thinkingLevel: 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH';
  imageModel: string;
}

export interface OpenAISettings {
  apiKey?: string;
  hasApiKey?: boolean;
  defaultModel: string;
  reasoningEffort: 'minimal' | 'low' | 'medium' | 'high';
  imageModel: string;
}

export interface AppSettings {
  gemini: GeminiSettings;
  openai: OpenAISettings;
}

export type Provider = 'gemini' | 'openai';

export const GEMINI_MODELS = [
  { id: 'gemini-3-pro-preview', label: 'Gemini 3 Pro' },
  { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash' },
] as const;

export const OPENAI_MODELS = [
  { id: 'gpt-5.2', label: 'GPT 5.2' },
  { id: 'gpt-5-mini', label: 'GPT 5-Mini' },
  { id: 'gpt-5-nano', label: 'GPT 5-Nano' },
] as const;

export const GEMINI_IMAGE_MODELS = [
  { id: 'gemini-3-pro-image-preview', label: 'Nano Banana Pro' },
  { id: 'gemini-2.5-flash-image', label: 'Nano Banana' },
] as const;

export const OPENAI_IMAGE_MODELS = [
  { id: 'gpt-image-1', label: 'GPT Image 1' },
  { id: 'gpt-image-1-mini', label: 'GPT Image 1-Mini' },
  { id: 'gpt-image-1.5', label: 'GPT Image 1.5' },
] as const;

import { GoogleGenAI } from '@google/genai';

export type ThinkingLevel = 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH';

interface GeminiMessage {
  role: 'user' | 'model';
  parts: Array<{ text: string }>;
}

interface GeminiStreamOptions {
  apiKey: string;
  model: string;
  thinkingLevel: ThinkingLevel;
  history: GeminiMessage[];
  userMessage: string;
  onChunk: (text: string) => void;
  onDone: () => void;
  onError: (err: Error) => void;
}

export async function streamGeminiChat(opts: GeminiStreamOptions): Promise<void> {
  const ai = new GoogleGenAI({ apiKey: opts.apiKey });

  const chat = ai.chats.create({
    model: opts.model,
    config: {
      thinkingConfig: {
        thinkingBudget: thinkingLevelToBudget(opts.thinkingLevel),
      },
    },
    history: opts.history,
  });

  try {
    const stream = await chat.sendMessageStream({ message: opts.userMessage });
    for await (const chunk of stream) {
      const text = chunk.text;
      if (text) {
        opts.onChunk(text);
      }
    }
    opts.onDone();
  } catch (err) {
    opts.onError(err instanceof Error ? err : new Error(String(err)));
  }
}

function thinkingLevelToBudget(level: ThinkingLevel): number {
  switch (level) {
    case 'MINIMAL': return 512;
    case 'LOW': return 1024;
    case 'MEDIUM': return 4096;
    case 'HIGH': return 8192;
  }
}

export type { GeminiMessage };

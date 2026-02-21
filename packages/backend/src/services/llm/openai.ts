import OpenAI from 'openai';
import type { ChatCompletionCreateParamsStreaming } from 'openai/resources/chat/completions';

export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';

interface OpenAIMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface OpenAIStreamOptions {
  apiKey: string;
  model: string;
  reasoningEffort: ReasoningEffort;
  messages: OpenAIMessage[];
  onChunk: (text: string) => void;
  onDone: () => void;
  onError: (err: Error) => void;
}

export async function streamOpenAIChat(opts: OpenAIStreamOptions): Promise<void> {
  const client = new OpenAI({ apiKey: opts.apiKey });

  try {
    const stream = await client.chat.completions.create({
      model: opts.model,
      messages: opts.messages,
      reasoning_effort: opts.reasoningEffort as ChatCompletionCreateParamsStreaming['reasoning_effort'],
      stream: true,
    });

    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content;
      if (text) {
        opts.onChunk(text);
      }
    }
    opts.onDone();
  } catch (err) {
    opts.onError(err instanceof Error ? err : new Error(String(err)));
  }
}

export type { OpenAIMessage };

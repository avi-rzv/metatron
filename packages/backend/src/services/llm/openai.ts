import OpenAI from 'openai';
import type { ChatCompletionCreateParamsStreaming } from 'openai/resources/chat/completions';
import type { RunnableToolFunctionWithParse } from 'openai/lib/RunnableFunction';
import type { AIToolCallbacks } from '../aiTools.js';

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
  systemInstruction?: string | null;
  toolCallbacks?: AIToolCallbacks | null;
  onChunk: (text: string) => void;
  onDone: () => void;
  onError: (err: Error) => void;
}

export async function streamOpenAIChat(opts: OpenAIStreamOptions): Promise<void> {
  const client = new OpenAI({ apiKey: opts.apiKey });

  try {
    const allMessages = [...opts.messages];
    if (opts.systemInstruction) {
      allMessages.unshift({ role: 'system', content: opts.systemInstruction });
    }

    if (opts.toolCallbacks) {
      const tools: RunnableToolFunctionWithParse<any>[] = [
        {
          type: 'function',
          function: {
            name: 'save_memory',
            description: 'Save critical facts about the user or important context to your persistent memory. This memory is included in every chat session. Use bullet points.',
            parameters: {
              type: 'object',
              properties: {
                memory: {
                  type: 'string',
                  description: 'The full updated memory content (bullet points). This replaces the entire memory, so include everything you want to remember.',
                },
              },
              required: ['memory'],
            },
            parse: JSON.parse,
            function: async (args: { memory: string }) => {
              return opts.toolCallbacks!.saveMemory(args.memory);
            },
          },
        },
        {
          type: 'function',
          function: {
            name: 'db_query',
            description: 'Execute a SQL query on your personal database. You can CREATE, INSERT, UPDATE, DELETE, and SELECT from tables with the ai_ prefix. Core app tables are protected.',
            parameters: {
              type: 'object',
              properties: {
                sql: {
                  type: 'string',
                  description: 'The SQL query to execute. Table names must use the ai_ prefix (e.g., ai_notes, ai_user_preferences).',
                },
              },
              required: ['sql'],
            },
            parse: JSON.parse,
            function: async (args: { sql: string }) => {
              return opts.toolCallbacks!.dbQuery(args.sql);
            },
          },
        },
        {
          type: 'function',
          function: {
            name: 'update_db_schema',
            description: 'Update your database schema documentation after creating, altering, or dropping tables. This documentation helps you remember what tables and columns exist in future sessions.',
            parameters: {
              type: 'object',
              properties: {
                schema: {
                  type: 'string',
                  description: 'Markdown documentation of all your current ai_ tables, their columns, types, and purposes.',
                },
              },
              required: ['schema'],
            },
            parse: JSON.parse,
            function: async (args: { schema: string }) => {
              return opts.toolCallbacks!.updateDbSchema(args.schema);
            },
          },
        },
      ];

      const runner = client.beta.chat.completions
        .runTools({
          model: opts.model,
          messages: allMessages,
          reasoning_effort: opts.reasoningEffort as ChatCompletionCreateParamsStreaming['reasoning_effort'],
          stream: true,
          tools,
        })
        .on('content', (delta: string) => {
          opts.onChunk(delta);
        });

      await runner.finalChatCompletion();
      opts.onDone();
    } else {
      const stream = await client.chat.completions.create({
        model: opts.model,
        messages: allMessages,
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
    }
  } catch (err) {
    opts.onError(err instanceof Error ? err : new Error(String(err)));
  }
}

export type { OpenAIMessage };

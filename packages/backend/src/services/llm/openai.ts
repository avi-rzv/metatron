import OpenAI from 'openai';
import type { ChatCompletionCreateParamsStreaming } from 'openai/resources/chat/completions';
import type { RunnableToolFunctionWithParse } from 'openai/lib/RunnableFunction';
import type { AIToolCallbacks } from '../aiTools.js';

export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';

type OpenAIContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'input_audio'; input_audio: { data: string; format: string } }
  | { type: 'file'; file: { file_data: string; filename: string } };

interface OpenAIMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | OpenAIContentPart[];
}

interface OpenAIStreamOptions {
  apiKey: string;
  model: string;
  reasoningEffort: ReasoningEffort;
  messages: OpenAIMessage[];
  attachments?: Array<{ mimeType: string; data: string; name: string }>;
  systemInstruction?: string | null;
  toolCallbacks?: AIToolCallbacks | null;
  onChunk: (text: string) => void;
  onCitations?: (citations: { url: string; title: string }[]) => void;
  onDone: () => void;
  onError: (err: Error) => void;
}

function buildAttachmentPart(att: { mimeType: string; data: string; name: string }): OpenAIContentPart {
  if (att.mimeType.startsWith('image/')) {
    return { type: 'image_url', image_url: { url: `data:${att.mimeType};base64,${att.data}` } };
  }
  if (att.mimeType.startsWith('audio/')) {
    const format = att.mimeType.includes('mp3') || att.mimeType.includes('mpeg') ? 'mp3' : 'wav';
    return { type: 'input_audio', input_audio: { data: att.data, format } };
  }
  // Documents (PDF, text, CSV, video, etc.)
  return { type: 'file', file: { file_data: `data:${att.mimeType};base64,${att.data}`, filename: att.name } };
}

function extractOpenAICitations(
  completion: any,
  onCitations?: (citations: { url: string; title: string }[]) => void,
) {
  if (!onCitations) return;
  const annotations = completion?.choices?.[0]?.message?.annotations;
  if (!Array.isArray(annotations) || annotations.length === 0) return;

  const seen = new Set<string>();
  const citations: { url: string; title: string }[] = [];
  for (const ann of annotations) {
    if (ann.type === 'url_citation') {
      const cite = ann.url_citation ?? ann;
      const url = cite.url;
      if (url && !seen.has(url)) {
        seen.add(url);
        citations.push({ url, title: cite.title ?? '' });
      }
    }
  }
  if (citations.length > 0) {
    onCitations(citations);
  }
}

export async function streamOpenAIChat(opts: OpenAIStreamOptions): Promise<void> {
  const client = new OpenAI({ apiKey: opts.apiKey });

  try {
    const allMessages = [...opts.messages];

    // Convert the last user message to multipart if attachments are present
    if (opts.attachments?.length) {
      const lastIdx = allMessages.length - 1;
      const lastMsg = allMessages[lastIdx];
      if (lastMsg && lastMsg.role === 'user') {
        const parts: OpenAIContentPart[] = [];
        if (typeof lastMsg.content === 'string' && lastMsg.content) {
          parts.push({ type: 'text', text: lastMsg.content });
        }
        for (const att of opts.attachments) {
          parts.push(buildAttachmentPart(att));
        }
        allMessages[lastIdx] = { ...lastMsg, content: parts };
      }
    }

    if (opts.systemInstruction) {
      allMessages.unshift({ role: 'system', content: opts.systemInstruction });
    }

    if (opts.toolCallbacks) {
      const tools: RunnableToolFunctionWithParse<any>[] = [];

      if (opts.toolCallbacks.webSearch) {
        tools.push({
          type: 'function',
          function: {
            name: 'web_search',
            description: 'Search the web for current information. Use this when the user asks about recent events, news, current data, or anything that may require up-to-date information.',
            parameters: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'The search query to look up on the web.',
                },
              },
              required: ['query'],
            },
            parse: JSON.parse,
            function: async (args: { query: string }) => {
              return opts.toolCallbacks!.webSearch!(args.query);
            },
          },
        });
      }

      if (opts.toolCallbacks.generateImage) {
        tools.push({
          type: 'function',
          function: {
            name: 'generate_image',
            description: 'Generate an image from a text description. Use this when the user asks you to create, draw, generate, or make an image/picture/illustration.',
            parameters: {
              type: 'object',
              properties: {
                prompt: {
                  type: 'string',
                  description: 'A detailed description of the image to generate.',
                },
                short_description: {
                  type: 'string',
                  description: 'A short 3-5 word label describing what is in the image (e.g. "sunset over the ocean", "black cat sleeping"). Used as a caption.',
                },
              },
              required: ['prompt', 'short_description'],
            },
            parse: JSON.parse,
            function: async (args: { prompt: string; short_description: string }) => {
              return opts.toolCallbacks!.generateImage!(args.prompt, args.short_description ?? '');
            },
          },
        });
      }

      if (opts.toolCallbacks.editImage) {
        tools.push({
          type: 'function',
          function: {
            name: 'edit_image',
            description: 'Edit a previously generated image. Use this when the user wants to modify, change, or update an existing image. Reference the image by its ID from the [Generated Image] annotations in the conversation.',
            parameters: {
              type: 'object',
              properties: {
                image_id: {
                  type: 'string',
                  description: 'The ID of the previously generated image to edit (from [Generated Image] annotations).',
                },
                prompt: {
                  type: 'string',
                  description: 'A detailed description of the changes to make to the image.',
                },
                short_description: {
                  type: 'string',
                  description: 'A short 3-5 word label describing the edited image (e.g. "forest at night", "cat with hat"). Used as a caption.',
                },
              },
              required: ['image_id', 'prompt', 'short_description'],
            },
            parse: JSON.parse,
            function: async (args: { image_id: string; prompt: string; short_description: string }) => {
              return opts.toolCallbacks!.editImage!(args.image_id, args.prompt, args.short_description ?? '');
            },
          },
        });
      }

      tools.push(
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
      );

      const runner = client.beta.chat.completions
        .runTools({
          model: opts.model,
          messages: allMessages as any,
          reasoning_effort: opts.reasoningEffort as ChatCompletionCreateParamsStreaming['reasoning_effort'],
          stream: true,
          tools,
        })
        .on('content', (delta: string) => {
          opts.onChunk(delta);
        });

      const finalCompletion = await runner.finalChatCompletion();
      extractOpenAICitations(finalCompletion, opts.onCitations);
      opts.onDone();
    } else {
      // Simple streaming chat completion (no tools)
      const stream = await client.chat.completions.create({
        model: opts.model,
        messages: allMessages as any,
        reasoning_effort: opts.reasoningEffort as ChatCompletionCreateParamsStreaming['reasoning_effort'],
        stream: true,
      });

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          opts.onChunk(delta);
        }
      }
      opts.onDone();
    }
  } catch (err) {
    opts.onError(err instanceof Error ? err : new Error(String(err)));
  }
}

export type { OpenAIMessage };

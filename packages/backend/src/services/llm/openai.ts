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

      if (opts.toolCallbacks.whatsappReadMessages) {
        tools.push({
          type: 'function',
          function: {
            name: 'whatsapp_read_messages',
            description: 'Read recent WhatsApp messages. Optionally filter by contact phone number.',
            parameters: {
              type: 'object',
              properties: {
                contact: {
                  type: 'string',
                  description: 'Phone number to filter messages by (optional). If omitted, returns all recent messages.',
                },
                limit: {
                  type: 'number',
                  description: 'Maximum number of messages to return (default: 20, max: 100).',
                },
              },
            },
            parse: JSON.parse,
            function: async (args: { contact?: string; limit?: number }) => {
              return opts.toolCallbacks!.whatsappReadMessages!(args.contact, args.limit || 20);
            },
          },
        });
      }

      if (opts.toolCallbacks.whatsappSendMessage) {
        tools.push({
          type: 'function',
          function: {
            name: 'whatsapp_send_message',
            description: 'Send a WhatsApp message to a phone number. Requires reply permission for the contact. Always confirm with the user before sending. Supports voice notes via as_voice flag.',
            parameters: {
              type: 'object',
              properties: {
                phone: {
                  type: 'string',
                  description: 'The recipient phone number in international format (e.g. "14155551234").',
                },
                message: {
                  type: 'string',
                  description: 'The text message to send (or text to convert to voice if as_voice is true).',
                },
                as_voice: {
                  type: 'boolean',
                  description: 'If true, convert the message text to a voice note and send as a WhatsApp voice message (PTT). Falls back to text if TTS fails.',
                },
              },
              required: ['phone', 'message'],
            },
            parse: JSON.parse,
            function: async (args: { phone: string; message: string; as_voice?: boolean }) => {
              return opts.toolCallbacks!.whatsappSendMessage!(args.phone, args.message, args.as_voice);
            },
          },
        });
      }

      if (opts.toolCallbacks.whatsappManagePermission) {
        tools.push({
          type: 'function',
          function: {
            name: 'whatsapp_manage_permission',
            description: 'Manage WhatsApp contact permissions. Grant, update, revoke, or remove read/reply access for a phone number.',
            parameters: {
              type: 'object',
              properties: {
                action: {
                  type: 'string',
                  description: 'The action to perform: "grant" (create/update permission), "update" (same as grant), "revoke" (disable read+reply), "remove" (delete entry entirely).',
                },
                phone_number: {
                  type: 'string',
                  description: 'The phone number in international format (e.g. "14155551234").',
                },
                display_name: {
                  type: 'string',
                  description: 'A display name for the contact (e.g. "Mom"). Required when granting new permission.',
                },
                can_read: {
                  type: 'boolean',
                  description: 'Whether the AI can read messages from this contact. Defaults to true when granting.',
                },
                can_reply: {
                  type: 'boolean',
                  description: 'Whether the AI can automatically reply to this contact. Defaults to false when granting.',
                },
                chat_instructions: {
                  type: 'string',
                  description: 'Custom instructions for AI behavior when chatting with this contact (e.g. "only discuss tech topics", "respond formally"). Stored on the permission and injected into auto-reply prompts.',
                },
              },
              required: ['action', 'phone_number'],
            },
            parse: JSON.parse,
            function: async (args: { action: string; phone_number: string; display_name?: string; can_read?: boolean; can_reply?: boolean; chat_instructions?: string }) => {
              return opts.toolCallbacks!.whatsappManagePermission!(args.action, args.phone_number, args.display_name, args.can_read, args.can_reply, args.chat_instructions);
            },
          },
        });
      }

      if (opts.toolCallbacks.whatsappListPermissions) {
        tools.push({
          type: 'function',
          function: {
            name: 'whatsapp_list_permissions',
            description: 'List all WhatsApp contact permissions showing who the AI can read from and reply to.',
            parameters: {
              type: 'object',
              properties: {},
            },
            parse: JSON.parse,
            function: async () => {
              return opts.toolCallbacks!.whatsappListPermissions!();
            },
          },
        });
      }

      tools.push(
        {
          type: 'function',
          function: {
            name: 'manage_cronjob',
            description: 'Create, list, update, delete, or toggle recurring scheduled tasks (cronjobs). When the user asks you to do something on a schedule (e.g. "every day at 9pm summarize news"), use this tool to create a cronjob.',
            parameters: {
              type: 'object',
              properties: {
                action: {
                  type: 'string',
                  description: 'The action: "create", "list", "update", "delete", or "toggle".',
                },
                name: {
                  type: 'string',
                  description: 'A short descriptive name for the cronjob (required for create).',
                },
                instruction: {
                  type: 'string',
                  description: 'The instruction the AI should execute when the cronjob fires (required for create).',
                },
                cron_expression: {
                  type: 'string',
                  description: 'A cron expression like "0 21 * * *" for 9pm daily (required for create). Format: minute hour day-of-month month day-of-week.',
                },
                job_id: {
                  type: 'string',
                  description: 'The ID of the cronjob (required for update, delete, toggle).',
                },
                enabled: {
                  type: 'boolean',
                  description: 'Whether the cronjob is enabled (used with update).',
                },
              },
              required: ['action'],
            },
            parse: JSON.parse,
            function: async (args: { action: string; name?: string; instruction?: string; cron_expression?: string; job_id?: string; enabled?: boolean }) => {
              return opts.toolCallbacks!.manageCronjob(args.action, args.name, args.instruction, args.cron_expression, args.job_id, args.enabled);
            },
          },
        },
        {
          type: 'function',
          function: {
            name: 'manage_pulse',
            description: 'Manage the Pulse heartbeat system — your autonomous periodic execution. Actions: "update_notes" (save continuity notes for next pulse), "get_config" (read current settings + remaining pulses + next pulse time), "update_config" (change enabled, active_days, pulses_per_day, quiet_hours).',
            parameters: {
              type: 'object',
              properties: {
                action: {
                  type: 'string',
                  description: 'The action: "update_notes", "get_config", or "update_config".',
                },
                notes: {
                  type: 'string',
                  description: 'Continuity notes for next pulse (max 2000 chars). Used with "update_notes".',
                },
                enabled: {
                  type: 'boolean',
                  description: 'Enable or disable the pulse system. Used with "update_config".',
                },
                active_days: {
                  type: 'array',
                  description: 'Days of week the pulse is active (0=Sun..6=Sat). Used with "update_config".',
                  items: { type: 'number' },
                },
                pulses_per_day: {
                  type: 'number',
                  description: 'How many pulses per day: 48 (every 30min), 24 (hourly), 12 (every 2h), 6 (every 4h), or 2 (every 12h). Used with "update_config".',
                },
                quiet_hours: {
                  type: 'array',
                  description: 'Time ranges when pulses are suppressed. Array of {start, end} in "HH:mm" 24h format. Used with "update_config".',
                  items: {
                    type: 'object',
                    properties: {
                      start: { type: 'string', description: 'Start time in HH:mm format' },
                      end: { type: 'string', description: 'End time in HH:mm format' },
                    },
                    required: ['start', 'end'],
                  },
                },
              },
              required: ['action'],
            },
            parse: JSON.parse,
            function: async (args: { action: string; notes?: string; enabled?: boolean; active_days?: number[]; pulses_per_day?: number; quiet_hours?: Array<{ start: string; end: string }> }) => {
              return opts.toolCallbacks!.managePulse(args.action, args.notes, args.enabled, args.active_days, args.pulses_per_day, args.quiet_hours);
            },
          },
        },
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
            description: 'Execute a MongoDB operation on your personal database. You have full read/write access to AI-managed collections (master, contacts, schedule) and ai_-prefixed collections. Core app collections (chats, messages, settings, media, attachments) are read-only.',
            parameters: {
              type: 'object',
              properties: {
                operation: {
                  type: 'string',
                  description: 'The MongoDB operation: find, findOne, insertOne, insertMany, updateOne, updateMany, deleteOne, deleteMany, countDocuments, aggregate, createCollection, createIndex, listCollections.',
                },
                collection: {
                  type: 'string',
                  description: 'The collection name. AI-managed collections (master, contacts, schedule) support full read/write. Other write operations require the ai_ prefix (e.g., ai_notes).',
                },
                filter: {
                  type: 'object',
                  description: 'Query filter object (e.g., {"status": "active"}).',
                },
                data: {
                  type: 'object',
                  description: 'Document(s) to insert. Single object for insertOne, array for insertMany.',
                },
                update: {
                  type: 'object',
                  description: 'Update operations (e.g., {"$set": {"name": "new"}}). Required for updateOne/updateMany.',
                },
                sort: {
                  type: 'object',
                  description: 'Sort specification (e.g., {"createdAt": -1}).',
                },
                limit: {
                  type: 'number',
                  description: 'Maximum number of documents to return.',
                },
              },
              required: ['operation', 'collection'],
            },
            parse: JSON.parse,
            function: async (args: any) => {
              return opts.toolCallbacks!.dbQuery(args);
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

import {
  GoogleGenAI,
  FunctionCallingConfigMode,
  Type,
  createPartFromFunctionResponse,
  type FunctionDeclaration,
  type FunctionCall,
  type Part,
} from '@google/genai';
import type { AIToolCallbacks } from '../aiTools.js';

export type ThinkingLevel = 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH';

interface GeminiMessage {
  role: 'user' | 'model';
  parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }>;
}

interface GeminiStreamOptions {
  apiKey: string;
  model: string;
  thinkingLevel: ThinkingLevel;
  history: GeminiMessage[];
  userMessage: string;
  attachments?: Array<{ mimeType: string; data: string }>;
  systemInstruction?: string | null;
  toolCallbacks?: AIToolCallbacks | null;
  onChunk: (text: string) => void;
  onCitations?: (citations: { url: string; title: string }[]) => void;
  onDone: () => void;
  onError: (err: Error) => void;
}

const TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: 'save_memory',
    description: 'Save critical facts about the user or important context to your persistent memory. This memory is included in every chat session. Use bullet points.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        memory: {
          type: Type.STRING,
          description: 'The full updated memory content (bullet points). This replaces the entire memory, so include everything you want to remember.',
        },
      },
      required: ['memory'],
    },
  },
  {
    name: 'db_query',
    description: 'Execute a MongoDB operation on your personal database. You have full read/write access to AI-managed collections (master, contacts, schedule) and ai_-prefixed collections. Core app collections (chats, messages, settings, media, attachments) are read-only.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        operation: {
          type: Type.STRING,
          description: 'The MongoDB operation: find, findOne, insertOne, insertMany, updateOne, updateMany, deleteOne, deleteMany, countDocuments, aggregate, createCollection, createIndex, listCollections.',
        },
        collection: {
          type: Type.STRING,
          description: 'The collection name. AI-managed collections (master, contacts, schedule) support full read/write. Other write operations require the ai_ prefix (e.g., ai_notes).',
        },
        filter: {
          type: Type.OBJECT,
          description: 'Query filter object (e.g., {"status": "active"}).',
          properties: {},
        },
        data: {
          type: Type.OBJECT,
          description: 'Document(s) to insert. Single object for insertOne, array for insertMany.',
          properties: {},
        },
        update: {
          type: Type.OBJECT,
          description: 'Update operations (e.g., {"$set": {"name": "new"}}). Required for updateOne/updateMany.',
          properties: {},
        },
        sort: {
          type: Type.OBJECT,
          description: 'Sort specification (e.g., {"createdAt": -1}).',
          properties: {},
        },
        limit: {
          type: Type.NUMBER,
          description: 'Maximum number of documents to return.',
        },
      },
      required: ['operation', 'collection'],
    },
  },
  {
    name: 'update_db_schema',
    description: 'Update your database schema documentation after creating, altering, or dropping tables. This documentation helps you remember what tables and columns exist in future sessions.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        schema: {
          type: Type.STRING,
          description: 'Markdown documentation of all your current ai_ tables, their columns, types, and purposes.',
        },
      },
      required: ['schema'],
    },
  },
  {
    name: 'manage_cronjob',
    description: 'Create, list, update, delete, or toggle recurring scheduled tasks (cronjobs). When the user asks you to do something on a schedule (e.g. "every day at 9pm summarize news"), use this tool to create a cronjob.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          description: 'The action: "create", "list", "update", "delete", or "toggle".',
        },
        name: {
          type: Type.STRING,
          description: 'A short descriptive name for the cronjob (required for create).',
        },
        instruction: {
          type: Type.STRING,
          description: 'The instruction the AI should execute when the cronjob fires (required for create).',
        },
        cron_expression: {
          type: Type.STRING,
          description: 'A cron expression like "0 21 * * *" for 9pm daily (required for create). Format: minute hour day-of-month month day-of-week.',
        },
        job_id: {
          type: Type.STRING,
          description: 'The ID of the cronjob (required for update, delete, toggle).',
        },
        enabled: {
          type: Type.BOOLEAN,
          description: 'Whether the cronjob is enabled (used with update).',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'manage_pulse',
    description: 'Manage the Pulse heartbeat system — your autonomous periodic execution. Actions: "update_notes" (save continuity notes for next pulse), "get_config" (read current settings + remaining pulses + next pulse time), "update_config" (change enabled, active_days, pulses_per_day, quiet_hours).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          description: 'The action: "update_notes", "get_config", or "update_config".',
        },
        notes: {
          type: Type.STRING,
          description: 'Continuity notes for next pulse (max 2000 chars). Used with "update_notes".',
        },
        enabled: {
          type: Type.BOOLEAN,
          description: 'Enable or disable the pulse system. Used with "update_config".',
        },
        active_days: {
          type: Type.ARRAY,
          description: 'Days of week the pulse is active (0=Sun..6=Sat). Used with "update_config".',
          items: { type: Type.NUMBER },
        },
        pulses_per_day: {
          type: Type.NUMBER,
          description: 'How many pulses per day: 48 (every 30min), 24 (hourly), 12 (every 2h), 6 (every 4h), or 2 (every 12h). Used with "update_config".',
        },
        quiet_hours: {
          type: Type.ARRAY,
          description: 'Time ranges when pulses are suppressed. Array of {start, end} in "HH:mm" 24h format. Used with "update_config".',
          items: {
            type: Type.OBJECT,
            properties: {
              start: { type: Type.STRING, description: 'Start time in HH:mm format' },
              end: { type: Type.STRING, description: 'End time in HH:mm format' },
            },
            required: ['start', 'end'],
          },
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'generate_image',
    description: 'Generate an image from a text description. Use this when the user asks you to create, draw, generate, or make an image/picture/illustration.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        prompt: {
          type: Type.STRING,
          description: 'A detailed description of the image to generate.',
        },
        short_description: {
          type: Type.STRING,
          description: 'A short 3-5 word label describing what is in the image (e.g. "sunset over the ocean", "black cat sleeping"). Used as a caption.',
        },
      },
      required: ['prompt', 'short_description'],
    },
  },
  {
    name: 'edit_image',
    description: 'Edit a previously generated image. Use this when the user wants to modify, change, or update an existing image. Reference the image by its ID from the [Generated Image] annotations in the conversation.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        image_id: {
          type: Type.STRING,
          description: 'The ID of the previously generated image to edit (from [Generated Image] annotations).',
        },
        prompt: {
          type: Type.STRING,
          description: 'A detailed description of the changes to make to the image.',
        },
        short_description: {
          type: Type.STRING,
          description: 'A short 3-5 word label describing the edited image (e.g. "forest at night", "cat with hat"). Used as a caption.',
        },
      },
      required: ['image_id', 'prompt', 'short_description'],
    },
  },
];

async function executeFunctionCalls(
  functionCalls: FunctionCall[],
  callbacks: AIToolCallbacks,
): Promise<Part[]> {
  const responseParts: Part[] = [];

  for (const fc of functionCalls) {
    const name = fc.name!;
    const args = (fc.args ?? {}) as Record<string, string>;
    let resultStr: string;

    switch (name) {
      case 'save_memory':
        resultStr = await callbacks.saveMemory(args.memory ?? '');
        break;
      case 'db_query':
        resultStr = await callbacks.dbQuery(args as any);
        break;
      case 'update_db_schema':
        resultStr = await callbacks.updateDbSchema(args.schema ?? '');
        break;
      case 'web_search':
        if (callbacks.webSearch) {
          resultStr = await callbacks.webSearch(args.query ?? '');
        } else {
          resultStr = JSON.stringify({ error: 'Web search is not enabled' });
        }
        break;
      case 'generate_image':
        if (callbacks.generateImage) {
          resultStr = await callbacks.generateImage(args.prompt ?? '', args.short_description ?? '');
        } else {
          resultStr = JSON.stringify({ error: 'Image generation is not enabled' });
        }
        break;
      case 'edit_image':
        if (callbacks.editImage) {
          resultStr = await callbacks.editImage(args.image_id ?? '', args.prompt ?? '', args.short_description ?? '');
        } else {
          resultStr = JSON.stringify({ error: 'Image editing is not enabled' });
        }
        break;
      case 'whatsapp_read_messages':
        if (callbacks.whatsappReadMessages) {
          resultStr = await callbacks.whatsappReadMessages(args.contact, Number(args.limit) || 20);
        } else {
          resultStr = JSON.stringify({ error: 'WhatsApp is not connected' });
        }
        break;
      case 'whatsapp_send_message':
        if (callbacks.whatsappSendMessage) {
          resultStr = await callbacks.whatsappSendMessage(args.phone ?? '', args.message ?? '', String(args.as_voice) === 'true');
        } else {
          resultStr = JSON.stringify({ error: 'WhatsApp is not connected' });
        }
        break;
      case 'whatsapp_manage_permission':
        if (callbacks.whatsappManagePermission) {
          resultStr = await callbacks.whatsappManagePermission(
            args.action ?? '',
            args.phone_number ?? '',
            args.display_name,
            args.can_read !== undefined ? String(args.can_read) === 'true' : undefined,
            args.can_reply !== undefined ? String(args.can_reply) === 'true' : undefined,
            args.chat_instructions,
          );
        } else {
          resultStr = JSON.stringify({ error: 'WhatsApp is not connected' });
        }
        break;
      case 'whatsapp_list_permissions':
        if (callbacks.whatsappListPermissions) {
          resultStr = await callbacks.whatsappListPermissions();
        } else {
          resultStr = JSON.stringify({ error: 'WhatsApp is not connected' });
        }
        break;
      case 'whatsapp_list_groups':
        if (callbacks.whatsappListGroups) {
          resultStr = await callbacks.whatsappListGroups();
        } else {
          resultStr = JSON.stringify({ error: 'WhatsApp is not connected' });
        }
        break;
      case 'whatsapp_manage_group_permission':
        if (callbacks.whatsappManageGroupPermission) {
          resultStr = await callbacks.whatsappManageGroupPermission(
            args.action ?? '',
            args.group_jid ?? '',
            args.group_name,
            args.can_read !== undefined ? String(args.can_read) === 'true' : undefined,
            args.can_reply !== undefined ? String(args.can_reply) === 'true' : undefined,
            args.chat_instructions,
          );
        } else {
          resultStr = JSON.stringify({ error: 'WhatsApp is not connected' });
        }
        break;
      case 'manage_cronjob':
        resultStr = await callbacks.manageCronjob(
          args.action ?? '',
          args.name,
          args.instruction,
          args.cron_expression,
          args.job_id,
          args.enabled !== undefined ? String(args.enabled) === 'true' : undefined,
        );
        break;
      case 'manage_pulse': {
        const quietHoursArg = (fc.args as any)?.quiet_hours;
        const activeDaysArg = (fc.args as any)?.active_days;
        resultStr = await callbacks.managePulse(
          args.action ?? '',
          args.notes,
          args.enabled !== undefined ? String(args.enabled) === 'true' : undefined,
          activeDaysArg ? (Array.isArray(activeDaysArg) ? activeDaysArg.map(Number) : undefined) : undefined,
          args.pulses_per_day !== undefined ? Number(args.pulses_per_day) : undefined,
          quietHoursArg,
        );
        break;
      }
      default:
        resultStr = JSON.stringify({ error: `Unknown function: ${name}` });
    }

    let resultObj: Record<string, unknown>;
    try {
      const parsed = JSON.parse(resultStr);
      // Gemini API requires response to be a JSON object (Struct), not an array
      resultObj = Array.isArray(parsed) ? { data: parsed } : parsed;
    } catch {
      resultObj = { result: resultStr };
    }

    responseParts.push(createPartFromFunctionResponse(fc.id ?? '', name, resultObj));
  }

  return responseParts;
}

export async function streamGeminiChat(opts: GeminiStreamOptions): Promise<void> {
  const ai = new GoogleGenAI({ apiKey: opts.apiKey });

  const config: Record<string, unknown> = {
    thinkingConfig: {
      thinkingBudget: thinkingLevelToBudget(opts.thinkingLevel),
    },
  };

  if (opts.systemInstruction) {
    config.systemInstruction = opts.systemInstruction;
  }

  if (opts.toolCallbacks) {
    const declarations = [...TOOL_DECLARATIONS];
    if (opts.toolCallbacks.webSearch) {
      declarations.push({
        name: 'web_search',
        description: 'Search the web for current information. Use this when the user asks about recent events, news, current data, or anything that may require up-to-date information.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            query: {
              type: Type.STRING,
              description: 'The search query to look up on the web.',
            },
          },
          required: ['query'],
        },
      });
    }
    if (opts.toolCallbacks.whatsappReadMessages) {
      declarations.push({
        name: 'whatsapp_read_messages',
        description: 'Read recent WhatsApp messages. For individual contacts, only returns messages from contacts with read permission. For groups, use the group JID (from whatsapp_list_groups). Optionally filter by contact phone number or group JID.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            contact: {
              type: Type.STRING,
              description: 'Phone number or group JID to filter messages by (optional). Use a group JID like "120363012345678@g.us" for group chats. If omitted, returns all recent messages from permitted contacts.',
            },
            limit: {
              type: Type.NUMBER,
              description: 'Maximum number of messages to return (default: 20, max: 100).',
            },
          },
        },
      });
    }
    if (opts.toolCallbacks.whatsappSendMessage) {
      declarations.push({
        name: 'whatsapp_send_message',
        description: 'Send a WhatsApp message to a phone number or group. Requires reply permission for individual contacts (not needed for groups). Always confirm with the user before sending. Supports voice notes via as_voice flag.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            phone: {
              type: Type.STRING,
              description: 'The recipient phone number in international format (e.g. "14155551234") or a group JID (e.g. "120363012345678@g.us") from whatsapp_list_groups.',
            },
            message: {
              type: Type.STRING,
              description: 'The text message to send (or text to convert to voice if as_voice is true).',
            },
            as_voice: {
              type: Type.BOOLEAN,
              description: 'If true, convert the message text to a voice note and send as a WhatsApp voice message (PTT). Falls back to text if TTS fails.',
            },
          },
          required: ['phone', 'message'],
        },
      });
    }
    if (opts.toolCallbacks.whatsappManagePermission) {
      declarations.push({
        name: 'whatsapp_manage_permission',
        description: 'Manage WhatsApp contact permissions. Grant, update, revoke, or remove read/reply access for a phone number.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            action: {
              type: Type.STRING,
              description: 'The action to perform: "grant" (create/update permission), "update" (same as grant), "revoke" (disable read+reply), "remove" (delete entry entirely).',
            },
            phone_number: {
              type: Type.STRING,
              description: 'The phone number in international format (e.g. "14155551234").',
            },
            display_name: {
              type: Type.STRING,
              description: 'A display name for the contact (e.g. "Mom"). Required when granting new permission.',
            },
            can_read: {
              type: Type.BOOLEAN,
              description: 'Whether the AI can read messages from this contact. Defaults to true when granting.',
            },
            can_reply: {
              type: Type.BOOLEAN,
              description: 'Whether the AI can automatically reply to this contact. Defaults to false when granting.',
            },
            chat_instructions: {
              type: Type.STRING,
              description: 'Custom instructions for AI behavior when chatting with this contact (e.g. "only discuss tech topics", "respond formally"). Stored on the permission and injected into auto-reply prompts.',
            },
          },
          required: ['action', 'phone_number'],
        },
      });
    }
    if (opts.toolCallbacks.whatsappListPermissions) {
      declarations.push({
        name: 'whatsapp_list_permissions',
        description: 'List all WhatsApp contact permissions showing who the AI can read from and reply to.',
        parameters: {
          type: Type.OBJECT,
          properties: {},
        },
      });
    }
    if (opts.toolCallbacks.whatsappListGroups) {
      declarations.push({
        name: 'whatsapp_list_groups',
        description: 'List all WhatsApp groups you are a member of. Returns group names, JIDs, and participant counts. Use the JID with whatsapp_read_messages or whatsapp_send_message to interact with a group.',
        parameters: {
          type: Type.OBJECT,
          properties: {},
        },
      });
    }
    if (opts.toolCallbacks.whatsappManageGroupPermission) {
      declarations.push({
        name: 'whatsapp_manage_group_permission',
        description: 'Manage WhatsApp group permissions. Set read/reply access and chat instructions for groups. Use whatsapp_list_groups first to get group JIDs. Actions: "set" (create or update), "list" (show all), "remove" (delete).',
        parameters: {
          type: Type.OBJECT,
          properties: {
            action: {
              type: Type.STRING,
              description: 'The action: "set" (create/update permission), "list" (show all group permissions), "remove" (delete permission).',
            },
            group_jid: {
              type: Type.STRING,
              description: 'The group JID (e.g. "120363012345678@g.us"). Required for set and remove.',
            },
            group_name: {
              type: Type.STRING,
              description: 'Display name for the group. Required when creating a new permission.',
            },
            can_read: {
              type: Type.BOOLEAN,
              description: 'Whether the AI can read messages from this group. Defaults to true when setting.',
            },
            can_reply: {
              type: Type.BOOLEAN,
              description: 'Whether the AI can automatically reply in this group. Defaults to false when setting.',
            },
            chat_instructions: {
              type: Type.STRING,
              description: 'Custom instructions for AI behavior in this group (e.g. "only respond when mentioned"). Stored on the permission and injected into auto-reply prompts.',
            },
          },
          required: ['action'],
        },
      });
    }
    // Remove image tools from declarations if callbacks are not available
    if (!opts.toolCallbacks.generateImage) {
      const idx = declarations.findIndex(d => d.name === 'generate_image');
      if (idx !== -1) declarations.splice(idx, 1);
    }
    if (!opts.toolCallbacks.editImage) {
      const idx = declarations.findIndex(d => d.name === 'edit_image');
      if (idx !== -1) declarations.splice(idx, 1);
    }
    config.tools = [{ functionDeclarations: declarations }];
    config.toolConfig = {
      functionCallingConfig: {
        mode: FunctionCallingConfigMode.AUTO,
      },
    };
  }

  const chat = ai.chats.create({
    model: opts.model,
    config,
    history: opts.history,
  });

  try {
    // Build message parts (text + optional attachments)
    const messageParts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];
    if (opts.userMessage) {
      messageParts.push({ text: opts.userMessage });
    }
    if (opts.attachments?.length) {
      for (const att of opts.attachments) {
        messageParts.push({ inlineData: { mimeType: att.mimeType, data: att.data } });
      }
    }

    // Initial message
    let stream = await chat.sendMessageStream({
      message: messageParts.length === 1 && 'text' in messageParts[0] ? opts.userMessage : messageParts,
    });
    let pendingFunctionCalls: FunctionCall[] = [];
    let lastGroundingMetadata: Record<string, unknown> | undefined;

    for await (const chunk of stream) {
      if (chunk.text) {
        opts.onChunk(chunk.text);
      }
      if (chunk.functionCalls) {
        pendingFunctionCalls.push(...chunk.functionCalls);
      }
      const metadata = (chunk as any).candidates?.[0]?.groundingMetadata;
      if (metadata) {
        lastGroundingMetadata = metadata;
      }
    }

    // Function call loop
    while (pendingFunctionCalls.length > 0 && opts.toolCallbacks) {
      const responseParts = await executeFunctionCalls(pendingFunctionCalls, opts.toolCallbacks);
      pendingFunctionCalls = [];

      stream = await chat.sendMessageStream({ message: responseParts });
      for await (const chunk of stream) {
        if (chunk.text) {
          opts.onChunk(chunk.text);
        }
        if (chunk.functionCalls) {
          pendingFunctionCalls.push(...chunk.functionCalls);
        }
        const metadata = (chunk as any).candidates?.[0]?.groundingMetadata;
        if (metadata) {
          lastGroundingMetadata = metadata;
        }
      }
    }

    // Extract citations from grounding metadata
    if (lastGroundingMetadata && opts.onCitations) {
      const chunks = (lastGroundingMetadata as any).groundingChunks as any[] | undefined;
      if (chunks?.length) {
        const citations = chunks
          .filter((c: any) => c.web)
          .map((c: any) => ({ url: c.web.uri ?? '', title: c.web.title ?? '' }));
        if (citations.length > 0) {
          opts.onCitations(citations);
        }
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

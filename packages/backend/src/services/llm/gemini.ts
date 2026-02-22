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
    description: 'Execute a SQL query on your personal database. You can CREATE, INSERT, UPDATE, DELETE, and SELECT from tables with the ai_ prefix. Core app tables are protected.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        sql: {
          type: Type.STRING,
          description: 'The SQL query to execute. Table names must use the ai_ prefix (e.g., ai_notes, ai_user_preferences).',
        },
      },
      required: ['sql'],
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
        resultStr = await callbacks.dbQuery(args.sql ?? '');
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

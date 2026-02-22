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
  parts: Array<{ text: string }>;
}

interface GeminiStreamOptions {
  apiKey: string;
  model: string;
  thinkingLevel: ThinkingLevel;
  history: GeminiMessage[];
  userMessage: string;
  systemInstruction?: string | null;
  toolCallbacks?: AIToolCallbacks | null;
  onChunk: (text: string) => void;
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
    config.tools = [{ functionDeclarations: TOOL_DECLARATIONS }];
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
    // Initial message
    let stream = await chat.sendMessageStream({ message: opts.userMessage });
    let pendingFunctionCalls: FunctionCall[] = [];

    for await (const chunk of stream) {
      if (chunk.text) {
        opts.onChunk(chunk.text);
      }
      if (chunk.functionCalls) {
        pendingFunctionCalls.push(...chunk.functionCalls);
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

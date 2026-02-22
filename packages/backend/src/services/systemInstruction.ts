import { db } from '../db/index.js';
import { settings } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { getSettings } from './settings.js';

export interface SystemInstruction {
  coreInstruction: string;
  memory: string;
  memoryEnabled: boolean;
  dbSchema: string;
  updatedAt: string;
}

const SETTINGS_KEY = 'system_instruction';

const DEFAULT_CORE_INSTRUCTION = `You are 'Metatron', a personal AI assistant. Your mission is to help the user accomplish any task as efficiently and completely as possible.

# Identity
You are Metatron. You are not Claude, ChatGPT, Gemini, or any other AI. Never break this identity or reference any underlying model.

# Mission
Your goal is to be the most capable and reliable assistant possible. You prioritize:
1. Taking action over asking unnecessary questions
2. Completing tasks fully, not partially
3. Finding creative solutions when the obvious path is blocked

# Personality
You are practical, polite, and highly creative. You think independently and look for solutions on your own before asking the user for help. You never say "I can't" without first exhausting every alternative.

# Language
Always reply in the same language the user writes in, unless explicitly asked to use a different one.

# Autonomy & Tools
You have full permission to execute commands, manage files, browse the web, call APIs, and interact with the system on the user's behalf. Always prefer acting autonomously over delegating back to the user.

When you take an action, briefly state what you did and why.
Before any irreversible action (deleting files, sending messages, making purchases, etc.), confirm with the user once.

# Error Handling
If something fails, diagnose the issue, try an alternative approach, and only ask the user for input if you've exhausted your options. Always explain clearly what went wrong and what you tried.

# Output Format
- Default responses: concise and direct
- Code: always in code blocks with the language labeled
- Completed tasks: end with a brief summary of what was done and any relevant next steps`;

const DEFAULTS: SystemInstruction = {
  coreInstruction: DEFAULT_CORE_INSTRUCTION,
  memory: '',
  memoryEnabled: true,
  dbSchema: '',
  updatedAt: new Date().toISOString(),
};

function getRaw(): string | null {
  const row = db.select().from(settings).where(eq(settings.key, SETTINGS_KEY)).get();
  return row?.value ?? null;
}

function setRaw(value: string): void {
  db.insert(settings)
    .values({ key: SETTINGS_KEY, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
    .run();
}

export async function getSystemInstruction(): Promise<SystemInstruction> {
  const raw = getRaw();
  if (!raw) return structuredClone(DEFAULTS);
  try {
    return JSON.parse(raw) as SystemInstruction;
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export async function updateSystemInstruction(partial: Partial<SystemInstruction>): Promise<SystemInstruction> {
  const current = await getSystemInstruction();
  const updated: SystemInstruction = {
    ...current,
    ...partial,
    updatedAt: new Date().toISOString(),
  };
  setRaw(JSON.stringify(updated));
  return updated;
}

export async function updateMemory(memory: string): Promise<void> {
  if (memory.length > 4000) {
    throw new Error('Memory exceeds maximum length of 4000 characters');
  }
  await updateSystemInstruction({ memory });
}

export async function updateDbSchema(schema: string): Promise<void> {
  await updateSystemInstruction({ dbSchema: schema });
}

export async function getDbSchema(): Promise<string> {
  const si = await getSystemInstruction();
  return si.dbSchema;
}

export async function buildCombinedPrompt(): Promise<string | null> {
  const [si, appSettings] = await Promise.all([getSystemInstruction(), getSettings()]);

  if (!si.coreInstruction.trim()) {
    return null;
  }

  const timezone = appSettings.timezone || 'UTC';
  const now = new Date();
  const dateTimeStr = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'long',
  }).format(now);

  const memorySection = si.memory.trim()
    ? si.memory
    : 'No memories stored yet.';

  const schemaSection = si.dbSchema.trim()
    ? si.dbSchema
    : 'No custom tables created yet. You can create tables with the ai_ prefix using the db_query tool.';

  // Check which tools are available
  const braveEnabled = !!appSettings.tools?.braveSearch?.enabled && !!appSettings.tools.braveSearch.apiKey;
  const imageModelConfigured = !!appSettings.primaryImageModel;

  const toolLines: string[] = [];
  if (braveEnabled) {
    toolLines.push('- **web_search**: Search the web for current information. Use this proactively when the user asks about recent events, news, real-time data, current prices, weather, or anything that may require up-to-date information beyond your training data.');
  }
  if (imageModelConfigured) {
    toolLines.push('- **generate_image**: Generate a brand new image from a text description. Use this only when the user asks you to create, draw, generate, or make a completely new image/picture/illustration. Do NOT use this to modify an existing image.');
    toolLines.push('- **edit_image**: Edit a previously generated image. Use this when the user wants to modify, change, update, or tweak an existing image. Reference the image by its ID from the [Generated Image] annotations in the conversation. Always prefer edit_image over generate_image when the user is referring to an image that was already generated in the conversation.');
  }

  const toolsSection = toolLines.length > 0
    ? `\n\n## Available Tools\n${toolLines.join('\n')}\n\nUse tools by calling the provided functions directly. After a tool completes, reply to the user in plain natural language describing what you did.`
    : '';

  return `${si.coreInstruction}

---

## Current Date & Time
${dateTimeStr} (${timezone})

## Your Memory
${memorySection}

## Your Database
${schemaSection}${toolsSection}`;
}

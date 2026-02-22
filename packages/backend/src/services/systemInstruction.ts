import { db } from '../db/index.js';
import { settings } from '../db/schema.js';
import { eq } from 'drizzle-orm';

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
  const si = await getSystemInstruction();

  if (!si.coreInstruction.trim()) {
    return null;
  }

  const memorySection = si.memory.trim()
    ? si.memory
    : 'No memories stored yet.';

  const schemaSection = si.dbSchema.trim()
    ? si.dbSchema
    : 'No custom tables created yet. You can create tables with the ai_ prefix using the db_query tool.';

  return `${si.coreInstruction}

---

## Your Memory
${memorySection}

## Your Database
${schemaSection}`;
}

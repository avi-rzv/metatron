import { settingsCol, waPermissionsCol, masterCol, contactsCol } from '../db/index.js';
import { getSettings, type AppSettings } from './settings.js';
import { getPulseInfo } from './pulseService.js';
import { whatsapp } from './whatsapp.js';

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
- Completed tasks: end with a brief summary of what was done and any relevant next steps

# Personal Data Management
You have access to three AI-managed collections for tracking user data. Use the db_query tool to read and write these directly.

## Master Profile (collection: "master")
- There should be exactly ONE document in this collection — the user's profile.
- Proactively extract personal details from conversation (name, profession, location, etc.) and upsert them.
- Never ask for all fields at once — gather incrementally from natural conversation.
- Use updateOne with upsert:true so the document is created on first write.

## Contacts (collection: "contacts")
- Store people the user mentions: family, friends, colleagues, etc.
- Set the "relation" field to describe how the contact relates to the user (e.g., "father", "best friend", "manager").
- Before inserting a new contact, check if one already exists with the same name to avoid duplicates.

## Schedule (collection: "schedule")
- Store calendar events, appointments, reminders, and deadlines.
- Use ISO dates for dtstart/dtend. Set allDay:true for full-day events.
- For recurring events, use an RFC 5545 RRULE string in the "rrule" field (e.g., "FREQ=WEEKLY;BYDAY=MO,WE,FR").
- Link events to contacts via "contactId" when relevant (e.g., "dinner with Dad").
- Set "status" to "confirmed" by default. Use "tentative" for unconfirmed plans.
- Use the "reminder" field (minutes before event) when the user requests to be reminded.

## Recurring Tasks (Cronjobs)
When the user asks you to do something on a recurring schedule (e.g. "every day at 9pm summarize today's tech news"), use the manage_cronjob tool to create a cronjob.
- Each cronjob has a cron expression (e.g. "0 21 * * *" for 9pm daily) and an instruction.
- When the cronjob fires, the instruction is executed by the AI and results are saved to a dedicated chat.
- You can list, update, toggle (enable/disable), or delete cronjobs.
- Common cron patterns: "0 9 * * *" (daily 9am), "0 21 * * *" (daily 9pm), "0 9 * * 1-5" (weekdays 9am), "0 9 * * 1" (Monday 9am), "0 * * * *" (every hour).

## Pulse (Autonomous Heartbeat)
The Pulse system runs periodically without user input. During pulse executions:
- Review your pulse notes for continuity — continue large tasks where you left off.
- Check schedule, contacts, and memory for organizational opportunities.
- Take proactive actions (clean up data, send reminders, prepare summaries).
- Use manage_pulse with action "update_notes" to save what you did and what to continue next time.
- Be mindful of your remaining pulses today — prioritize when limited.
- The user can modify pulse settings via the UI or ask you to change them via chat.`;

const DEFAULT_DB_SCHEMA = `### AI-Managed Collections

| Collection | Field | Type | Notes |
|---|---|---|---|
| **master** | _id | string | Single document — the user's profile |
| | firstName | string \\| null | |
| | lastName | string \\| null | |
| | dateOfBirth | string \\| null | ISO date |
| | gender | string \\| null | |
| | maritalStatus | string \\| null | single, married, engaged, divorced, widowed, other |
| | children | number \\| null | |
| | profession | string \\| null | |
| | phoneNumber | string \\| null | |
| | email | string \\| null | |
| | street | string \\| null | |
| | city | string \\| null | |
| | country | string \\| null | |
| | zipCode | string \\| null | |
| | createdAt | Date | |
| | updatedAt | Date | |
| **contacts** | _id | string | nanoid |
| | firstName | string \\| null | |
| | lastName | string \\| null | |
| | dateOfBirth | string \\| null | ISO date |
| | gender | string \\| null | |
| | maritalStatus | string \\| null | |
| | children | number \\| null | |
| | profession | string \\| null | |
| | phoneNumber | string \\| null | |
| | email | string \\| null | |
| | street | string \\| null | |
| | city | string \\| null | |
| | country | string \\| null | |
| | zipCode | string \\| null | |
| | relation | string | Required — father, friend, colleague, etc. |
| | createdAt | Date | |
| | updatedAt | Date | |
| **schedule** | _id | string | nanoid |
| | title | string | Required |
| | description | string \\| null | |
| | location | string \\| null | |
| | dtstart | Date | Required — event start |
| | dtend | Date | Required — event end |
| | allDay | boolean | true for full-day events |
| | rrule | string \\| null | RFC 5545 RRULE for recurrence |
| | status | string | confirmed, tentative, cancelled |
| | reminder | number \\| null | Minutes before event |
| | contactId | string \\| null | Links to contacts._id |
| | createdAt | Date | |
| | updatedAt | Date | |
| **whatsapp_permissions** | _id | string | nanoid |
| | phoneNumber | string | Digits only, unique |
| | displayName | string | User label (e.g. "Mom") |
| | contactId | string \\| null | Links to contacts._id |
| | canRead | boolean | AI can read messages from this contact |
| | canReply | boolean | AI can auto-reply to this contact |
| | chatInstructions | string \\| null | Per-contact AI behavior instructions for auto-reply |
| | chatId | string \\| null | Dedicated chat session ID |
| | createdAt | Date | |
| | updatedAt | Date | |
| **cronjobs** | _id | string | nanoid |
| | name | string | Short descriptive name |
| | instruction | string | What the AI does when triggered |
| | cronExpression | string | Cron schedule (e.g. "0 21 * * *") |
| | timezone | string | IANA timezone |
| | enabled | boolean | Whether the job is active |
| | chatId | string | Dedicated chat for execution results |
| | lastRunAt | Date \\| null | Last execution time |
| | nextRunAt | Date \\| null | Next scheduled time |
| | createdAt | Date | |
| | updatedAt | Date | |`;

const DEFAULTS: SystemInstruction = {
  coreInstruction: DEFAULT_CORE_INSTRUCTION,
  memory: '',
  memoryEnabled: true,
  dbSchema: DEFAULT_DB_SCHEMA,
  updatedAt: new Date().toISOString(),
};

async function getRaw(): Promise<string | null> {
  const row = await settingsCol.findOne({ _id: SETTINGS_KEY });
  return row?.value ?? null;
}

async function setRaw(value: string): Promise<void> {
  await settingsCol.updateOne({ _id: SETTINGS_KEY }, { $set: { value } }, { upsert: true });
}

export async function getSystemInstruction(): Promise<SystemInstruction> {
  const raw = await getRaw();
  if (!raw) return structuredClone(DEFAULTS);
  try {
    const si = JSON.parse(raw) as SystemInstruction;
    // Backfill defaults for existing deployments with missing fields
    if (!si.coreInstruction?.trim()) {
      si.coreInstruction = DEFAULT_CORE_INSTRUCTION;
    }
    if (!si.dbSchema?.trim()) {
      si.dbSchema = DEFAULT_DB_SCHEMA;
    }
    return si;
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
  await setRaw(JSON.stringify(updated));
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
    : 'No custom collections documented yet. You have built-in AI-managed collections (master, contacts, schedule) and can also create collections with the ai_ prefix using the db_query tool.';

  // Check which tools are available
  const braveEnabled = !!appSettings.tools?.braveSearch?.enabled && !!appSettings.tools.braveSearch.apiKey;
  const imageModelConfigured = !!appSettings.primaryImageModel;

  const toolLines: string[] = [
    '- **manage_cronjob**: Create, list, update, delete, or toggle recurring scheduled tasks. Use when the user asks for something to happen on a schedule (e.g. "every day at 9pm summarize news"). Actions: "create", "list", "update", "delete", "toggle".',
    '- **manage_pulse**: Manage the Pulse heartbeat. Actions: "update_notes" (save continuity notes), "get_config" (read settings + remaining pulses), "update_config" (change schedule/interval/days/quiet hours).',
  ];
  if (braveEnabled) {
    toolLines.push('- **web_search**: Search the web for current information. Use this proactively when the user asks about recent events, news, real-time data, current prices, weather, or anything that may require up-to-date information beyond your training data.');
  }
  if (imageModelConfigured) {
    toolLines.push('- **generate_image**: Generate a brand new image from a text description. Use this only when the user asks you to create, draw, generate, or make a completely new image/picture/illustration. Do NOT use this to modify an existing image.');
    toolLines.push('- **edit_image**: Edit a previously generated image. Use this when the user wants to modify, change, update, or tweak an existing image. Reference the image by its ID from the [Generated Image] annotations in the conversation. Always prefer edit_image over generate_image when the user is referring to an image that was already generated in the conversation.');
  }

  const whatsappConnected = whatsapp.status === 'connected';
  if (whatsappConnected) {
    toolLines.push('- **whatsapp_read_messages**: Read recent WhatsApp messages. Only returns messages from contacts with read permission. Optionally filter by a contact phone number.');
    toolLines.push('- **whatsapp_send_message**: Send a WhatsApp message to a phone number. Requires reply permission for the contact. IMPORTANT: Always confirm with the user before sending. Set `as_voice: true` to send as a voice note instead of text.');
    toolLines.push('- **whatsapp_manage_permission**: Manage WhatsApp contact permissions. Grant, update, revoke, or remove read/reply access for a phone number. Actions: "grant", "update", "revoke", "remove".');
    toolLines.push('- **whatsapp_list_permissions**: List all WhatsApp contact permissions showing who the AI can read from and reply to.');
  }

  const toolsSection = toolLines.length > 0
    ? `\n\n## Available Tools\n${toolLines.join('\n')}\n\nUse tools by calling the provided functions directly. After a tool completes, reply to the user in plain natural language describing what you did.`
    : '';

  // WhatsApp permissions section
  let whatsappSection = '';
  if (whatsappConnected) {
    try {
      const perms = await waPermissionsCol.find({}).sort({ displayName: 1 }).toArray();
      const permLines = perms.map(p =>
        `- ${p.displayName} (${p.phoneNumber}): read=${p.canRead}, reply=${p.canReply}`
      );
      const permList = permLines.length > 0 ? permLines.join('\n') : 'No permissions configured yet.';
      whatsappSection = `\n\n## WhatsApp Permissions\nWhatsApp is connected. Messages can only be read from and replied to contacts with explicit permission.\nWhen the user asks you to grant WhatsApp access, use \`whatsapp_manage_permission\` with the appropriate action.\nContacts with canReply=true will receive automatic replies when they message. Extract useful info from WhatsApp conversations to enrich contacts and schedule collections.\n\nCurrent permissions:\n${permList}`;
    } catch {
      whatsappSection = '';
    }
  }

  // Pulse status section
  let pulseSection = '';
  const pulse = appSettings.pulse;
  if (pulse) {
    const info = getPulseInfo(appSettings);
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const activeDayNames = pulse.activeDays.map(d => dayNames[d]).join(', ');
    const quietHoursStr = pulse.quietHours.length > 0
      ? pulse.quietHours.map(q => `${q.start}–${q.end}`).join(', ')
      : 'None';
    const statusStr = pulse.enabled ? 'Enabled' : 'Disabled';
    const lastPulse = pulse.lastPulseAt
      ? new Intl.DateTimeFormat('en-US', {
          timeZone: timezone,
          month: 'short', day: 'numeric',
          hour: 'numeric', minute: '2-digit',
        }).format(new Date(pulse.lastPulseAt))
      : 'Never';

    pulseSection = `\n\n## Pulse Status
- Status: ${statusStr}
- Interval: every ${info.intervalMinutes} minutes (${pulse.pulsesPerDay}/day)
- Active days: ${activeDayNames}
- Quiet hours: ${quietHoursStr}
- Pulses today: ${pulse.pulsesToday}/${pulse.pulsesPerDay} (${info.remaining} remaining)
- Last pulse: ${lastPulse}
- Next pulse: ${info.nextPulseAt ?? 'N/A'}`;

    if (pulse.notes.trim()) {
      pulseSection += `\n\n## Your Pulse Notes\n${pulse.notes}`;
    }
  }

  return `${si.coreInstruction}

---

## Current Date & Time
${dateTimeStr} (${timezone})

## Your Memory
${memorySection}

## Your Database
${schemaSection}${toolsSection}${whatsappSection}${pulseSection}`;
}

/**
 * Build a purpose-built system instruction for WhatsApp auto-reply.
 * Unlike buildCombinedPrompt(), this identifies the AI as the master's assistant
 * (not the master's personal AI) and includes privacy guardrails.
 */
export async function buildWhatsAppPrompt(opts: {
  contactId: string | null;
  phoneNumber: string;
  displayName: string;
}): Promise<string | null> {
  const [si, appSettings, masterDoc, permissionDoc] = await Promise.all([
    getSystemInstruction(),
    getSettings(),
    masterCol.findOne({}),
    waPermissionsCol.findOne({ phoneNumber: opts.phoneNumber.replace(/[^0-9]/g, '') }),
  ]);

  // Look up contact — try by contactId first, then by phone suffix matching
  let contactDoc = opts.contactId
    ? await contactsCol.findOne({ _id: opts.contactId })
    : null;

  if (!contactDoc) {
    // Suffix matching: strip both to digits, compare last 7+ digits
    const incomingDigits = opts.phoneNumber.replace(/[^0-9]/g, '');
    if (incomingDigits.length >= 7) {
      const suffix = incomingDigits.slice(-7);
      const allContacts = await contactsCol.find({ phoneNumber: { $ne: null } }).toArray();
      contactDoc = allContacts.find(c => {
        const cDigits = (c.phoneNumber ?? '').replace(/[^0-9]/g, '');
        return cDigits.length >= 7 && cDigits.endsWith(suffix);
      }) ?? null;
    }
  }

  if (!si.coreInstruction.trim()) return null;

  // Master name
  const masterParts = [masterDoc?.firstName, masterDoc?.lastName].filter(Boolean);
  const masterName = masterParts.length > 0 ? masterParts.join(' ') : 'your master';

  // Contact description
  let contactDesc: string;
  if (contactDoc) {
    const nameParts = [contactDoc.firstName, contactDoc.lastName].filter(Boolean);
    const contactName = nameParts.length > 0 ? nameParts.join(' ') : opts.displayName;
    contactDesc = contactDoc.relation
      ? `${contactName} (${contactDoc.relation})`
      : contactName;
  } else {
    contactDesc = `${opts.displayName} (phone: ${opts.phoneNumber})`;
  }

  // Date/time
  const timezone = appSettings.timezone || 'UTC';
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
  }).format(new Date());

  // Memory
  const memorySection = si.memory.trim()
    ? si.memory
    : 'No memories stored yet.';

  // DB schema
  const schemaSection = si.dbSchema.trim()
    ? si.dbSchema
    : 'No custom collections documented yet. You have built-in AI-managed collections (master, contacts, schedule) and can also create collections with the ai_ prefix using the db_query tool.';

  // Tool list — same conditions as buildCombinedPrompt
  const braveEnabled = !!appSettings.tools?.braveSearch?.enabled && !!appSettings.tools.braveSearch.apiKey;
  const imageModelConfigured = !!appSettings.primaryImageModel;

  const masterPhone = whatsapp.phoneNumber?.replace(/[^0-9]/g, '') ?? null;

  const waToolLines: string[] = [
    '- **save_memory**: Save important information to your persistent memory.',
    '- **db_query**: Query and modify MongoDB collections (master, contacts, schedule, whatsapp_permissions, and ai_* collections).',
    '- **update_db_schema**: Update the database schema documentation.',
    '- **manage_cronjob**: Create, list, update, delete, or toggle recurring scheduled tasks.',
    '- **whatsapp_send_message**: Send a WhatsApp message. You can message the master directly for urgent notifications. Set `as_voice: true` to send as a voice note.',
  ];
  if (braveEnabled) {
    waToolLines.push('- **web_search**: Search the web for current information.');
  }
  if (imageModelConfigured) {
    waToolLines.push('- **generate_image**: Generate an image from a text description.');
    waToolLines.push('- **edit_image**: Edit a previously generated image by its ID.');
  }

  const toolsSection = waToolLines.join('\n');

  // Notifications section — instruct AI when to self-message the master
  const notificationsSection = masterPhone
    ? `\n\n## Notifications
You can send WhatsApp messages to ${masterName} (phone: ${masterPhone}) to notify them about important matters.
Send a notification when:
- Something urgent comes up that needs ${masterName}'s attention
- A conversation reaches a natural conclusion (send a brief summary)
- A decision is needed that you cannot make on your own
- The contact shares time-sensitive information (e.g. meeting changes, emergencies)
Keep notifications concise. Do NOT notify for routine small-talk.`
    : '';

  // Per-contact chat instructions
  const chatInstructions = permissionDoc?.chatInstructions;
  const instructionsSection = chatInstructions
    ? `\n\n## Contact-Specific Instructions\nThe master has set the following instructions for conversations with ${opts.displayName}:\n${chatInstructions}`
    : '';

  return `# Identity
You are the personal assistant of ${masterName}. Your name is Metatron.

# Context
You are chatting on WhatsApp with ${contactDesc}.
You are reading and replying to messages on behalf of ${masterName}.

# Authority
You have permission to chat and reply on behalf of ${masterName}.
Respond naturally and helpfully as ${masterName}'s trusted personal assistant.

# Privacy & Safety
- NEVER reveal sensitive personal information about ${masterName} to any contact.
- NEVER share information about other contacts stored in the database.
- If a request seems sensitive or could have consequences, tell the contact you need
  to check with ${masterName} and save a reminder using your tools.
- When in doubt, err on the side of caution.

# Language
Always reply in the same language the contact writes in.

# Behavior
- Be concise and natural — this is WhatsApp, not email.
- Proactively extract useful info (names, dates, plans) and update contacts/schedule
  collections via db_query.
- If you learn new details about this contact, update their record.

# Voice Messages
- When you receive a voice message, you may reply with a voice note (as_voice=true) or text.
- For casual conversations, prefer voice replies to match the contact's communication style.
- Keep voice replies short and conversational — avoid long monologues.

---
## Current Date & Time
${dateTimeStr} (${timezone})

## Your Memory
${memorySection}

## Your Database
${schemaSection}

## Available Tools
${toolsSection}${notificationsSection}${instructionsSection}`;
}

/**
 * Build a system prompt specifically for autonomous Pulse executions.
 * Wraps buildCombinedPrompt() + appends pulse-specific execution context.
 */
export async function buildPulsePrompt(settings: AppSettings): Promise<string | null> {
  const base = await buildCombinedPrompt();
  if (!base) return null;

  const info = getPulseInfo(settings);
  const pulse = settings.pulse;

  return `${base}

---

## Pulse Execution Context
You are running autonomously as part of the Pulse heartbeat system. No user is interacting with you right now.
- Remaining pulses today: ${info.remaining}/${pulse.pulsesPerDay}
- Pulse interval: every ${info.intervalMinutes} minutes
- IMPORTANT: Always use manage_pulse with action "update_notes" at the end of this pulse to save what you did and what to continue next time.
- If you have many remaining pulses, you can spread work across multiple pulses.
- If pulses are limited, prioritize the most important actions.
- Do NOT ask the user questions — act autonomously based on available data.`;
}

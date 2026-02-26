import { nanoid } from 'nanoid';
import { chatsCol, messagesCol } from '../db/index.js';
import { registerPulseChatCleanup } from '../db/cascade.js';
import { getDecryptedSettings, getSettings, updateSettings, type AppSettings, type PulseSettings, type QuietHoursRange } from './settings.js';
import { buildPulsePrompt } from './systemInstruction.js';
import { createAIToolCallbacks, type MediaInfo } from './aiTools.js';
import { getThinkingLevelForModel } from './settings.js';
import { streamGeminiChat, type GeminiMessage } from './llm/gemini.js';
import { streamOpenAIChat, type OpenAIMessage } from './llm/openai.js';

// ---------------------------------------------------------------------------
// Async queue — processes one pulse execution at a time
// ---------------------------------------------------------------------------

class AsyncQueue {
  private queue: (() => Promise<void>)[] = [];
  private running = false;

  push(task: () => Promise<void>) {
    this.queue.push(task);
    if (!this.running) this.process();
  }

  private async process() {
    this.running = true;
    while (this.queue.length > 0) {
      const task = this.queue.shift()!;
      try {
        await task();
      } catch (err) {
        console.error('[PulseService] Queue task error:', err);
      }
    }
    this.running = false;
  }
}

const queue = new AsyncQueue();

// ---------------------------------------------------------------------------
// Tick loop
// ---------------------------------------------------------------------------

let tickInterval: ReturnType<typeof setInterval> | null = null;

const TICK_INTERVAL_MS = 60_000; // 60 seconds
const LLM_TIMEOUT = 180_000;    // 180 seconds

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

function getTodayStr(timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date());
}

function getCurrentTimeInTz(timezone: string): { hours: number; minutes: number; dayOfWeek: number } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
    weekday: 'short',
  }).formatToParts(now);

  let hours = 0;
  let minutes = 0;
  let weekdayStr = '';
  for (const p of parts) {
    if (p.type === 'hour') hours = parseInt(p.value, 10);
    if (p.type === 'minute') minutes = parseInt(p.value, 10);
    if (p.type === 'weekday') weekdayStr = p.value;
  }
  // Handle 24:00 edge case
  if (hours === 24) hours = 0;

  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dayOfWeek = dayMap[weekdayStr] ?? new Date().getDay();

  return { hours, minutes, dayOfWeek };
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function isInQuietHours(currentHours: number, currentMinutes: number, ranges: QuietHoursRange[]): boolean {
  const currentMin = currentHours * 60 + currentMinutes;
  for (const range of ranges) {
    const start = timeToMinutes(range.start);
    const end = timeToMinutes(range.end);
    if (start <= end) {
      // Same-day range (e.g., 09:00 → 17:00)
      if (currentMin >= start && currentMin < end) return true;
    } else {
      // Overnight range (e.g., 23:00 → 07:00)
      if (currentMin >= start || currentMin < end) return true;
    }
  }
  return false;
}

function getIntervalMinutes(pulsesPerDay: number): number {
  return Math.round((24 * 60) / pulsesPerDay);
}

// ---------------------------------------------------------------------------
// Should pulse fire?
// ---------------------------------------------------------------------------

function shouldPulseNow(settings: AppSettings): boolean {
  const pulse = settings.pulse;
  if (!pulse.enabled) return false;

  const timezone = settings.timezone || 'UTC';
  const { hours, minutes, dayOfWeek } = getCurrentTimeInTz(timezone);

  // Check active day
  if (!pulse.activeDays.includes(dayOfWeek)) return false;

  // Check quiet hours
  if (isInQuietHours(hours, minutes, pulse.quietHours)) return false;

  // Check if enough time has elapsed since last pulse
  const intervalMs = getIntervalMinutes(pulse.pulsesPerDay) * 60_000;
  if (pulse.lastPulseAt) {
    const elapsed = Date.now() - new Date(pulse.lastPulseAt).getTime();
    if (elapsed < intervalMs - 30_000) return false; // 30s grace window
  }

  return true;
}

// ---------------------------------------------------------------------------
// Get or create pulse chat
// ---------------------------------------------------------------------------

async function getOrCreatePulseChat(settings: AppSettings): Promise<string> {
  const pulse = settings.pulse;

  // If we have a chatId, verify it still exists
  if (pulse.chatId) {
    const existing = await chatsCol.findOne({ _id: pulse.chatId });
    if (existing) return pulse.chatId;
  }

  // Create new pulse chat
  const modelId = settings.primaryModel.modelId;
  const provider = modelId.startsWith('gemini') ? 'gemini' : 'openai';
  const chatId = nanoid();
  const now = new Date();

  await chatsCol.insertOne({
    _id: chatId,
    title: 'Pulse',
    provider,
    model: modelId,
    createdAt: now,
    updatedAt: now,
  });

  // Persist chatId to settings
  await updateSettings({ pulse: { ...pulse, chatId } });

  return chatId;
}

// ---------------------------------------------------------------------------
// Execute pulse
// ---------------------------------------------------------------------------

async function executePulse(): Promise<void> {
  // Re-read settings from DB
  const settings = await getDecryptedSettings();
  if (!shouldPulseNow(settings)) return;

  const pulse = settings.pulse;
  const timezone = settings.timezone || 'UTC';
  const todayStr = getTodayStr(timezone);

  console.log('[PulseService] Executing pulse');

  const modelId = settings.primaryModel.modelId;
  const provider = modelId.startsWith('gemini') ? 'gemini' : 'openai';
  const apiKey = settings.apiKeys[provider].apiKey;

  if (!apiKey) {
    console.warn(`[PulseService] No API key for ${provider} — skipping pulse`);
    return;
  }

  // Get/create dedicated pulse chat
  const chatId = await getOrCreatePulseChat(settings);

  // Reset pulsesToday if day changed
  let pulsesToday = pulse.pulsesToday;
  if (pulse.todayDate !== todayStr) {
    pulsesToday = 0;
  }

  // Build pulse instruction
  const pulseNotes = pulse.notes.trim() || 'No notes yet — this is the first pulse or notes were cleared.';
  const instruction = `[Pulse Heartbeat]
This is an autonomous pulse. Review your notes below, then:
1. Check schedule for upcoming events, broken entries, or organizational opportunities
2. Review contacts for incomplete or stale data
3. Check memory for pending tasks or follow-ups
4. Take proactive actions to assist the user
5. Update your pulse notes with what you did and what to continue next time

Your pulse notes:
${pulseNotes}`;

  // Insert instruction as user message
  const userMsgId = nanoid();
  const now = new Date();
  await messagesCol.insertOne({
    _id: userMsgId,
    chatId,
    role: 'user',
    content: instruction,
    citations: null,
    createdAt: now,
  });

  await chatsCol.updateOne({ _id: chatId }, { $set: { updatedAt: now } });

  // Load last 20 messages for context
  const history = await messagesCol
    .find({ chatId })
    .sort({ createdAt: -1 })
    .limit(21)
    .toArray();
  history.reverse();
  if (history.length > 0 && history[history.length - 1]._id === userMsgId) {
    history.pop();
  }

  // Pre-insert empty assistant message
  const assistantMsgId = nanoid();
  await messagesCol.insertOne({
    _id: assistantMsgId,
    chatId,
    role: 'assistant',
    content: '',
    citations: null,
    createdAt: new Date(),
  });

  // Build system prompt
  const systemInstruction = await buildPulsePrompt(settings);

  const thinkingLevel = getThinkingLevelForModel(settings, modelId);
  const braveApiKey = settings.tools?.braveSearch?.enabled && settings.tools.braveSearch.apiKey
    ? settings.tools.braveSearch.apiKey
    : undefined;

  const onImageGenerated = (media: MediaInfo) => {
    console.log(`[PulseService] Image generated: ${media.mediaId}`);
  };

  const toolCallbacks = createAIToolCallbacks({
    braveApiKey,
    chatId,
    messageId: assistantMsgId,
    settings,
    onImageGenerated,
  });

  let fullContent = '';
  let settled = false;

  const llmPromise = new Promise<void>((resolve) => {
    const settle = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    const onChunk = (text: string) => { fullContent += text; };
    const onDone = async () => {
      const content = fullContent.trim();
      await messagesCol.updateOne({ _id: assistantMsgId }, { $set: { content } });
      settle();
    };
    const onError = async (err: Error) => {
      console.error('[PulseService] LLM error:', err.message);
      if (!fullContent) {
        await messagesCol.deleteOne({ _id: assistantMsgId });
      } else {
        await messagesCol.updateOne({ _id: assistantMsgId }, { $set: { content: fullContent } });
      }
      settle();
    };

    if (provider === 'gemini') {
      const geminiHistory: GeminiMessage[] = history.map((m) => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.content }],
      }));

      streamGeminiChat({
        apiKey,
        model: modelId,
        thinkingLevel: thinkingLevel.toUpperCase() as 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH',
        history: geminiHistory,
        userMessage: instruction,
        systemInstruction,
        toolCallbacks,
        onChunk,
        onDone,
        onError,
      }).catch((err) => {
        onError(err instanceof Error ? err : new Error(String(err)));
      });
    } else {
      const openAIMessages: OpenAIMessage[] = history.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));
      openAIMessages.push({ role: 'user', content: instruction });

      streamOpenAIChat({
        apiKey,
        model: modelId,
        reasoningEffort: thinkingLevel as 'minimal' | 'low' | 'medium' | 'high',
        messages: openAIMessages,
        systemInstruction,
        toolCallbacks,
        onChunk,
        onDone,
        onError,
      }).catch((err) => {
        onError(err instanceof Error ? err : new Error(String(err)));
      });
    }
  });

  // Race against timeout
  const timeoutPromise = new Promise<void>((resolve) => {
    setTimeout(() => {
      if (!settled) {
        console.warn(`[PulseService] LLM timeout after ${LLM_TIMEOUT / 1000}s`);
        settled = true;
        if (fullContent) {
          messagesCol.updateOne({ _id: assistantMsgId }, { $set: { content: fullContent } }).catch(() => {});
        } else {
          messagesCol.deleteOne({ _id: assistantMsgId }).catch(() => {});
        }
      }
      resolve();
    }, LLM_TIMEOUT);
  });

  await Promise.race([llmPromise, timeoutPromise]);

  // Update pulse tracking
  await updateSettings({
    pulse: {
      ...pulse,
      chatId,
      lastPulseAt: new Date().toISOString(),
      pulsesToday: pulsesToday + 1,
      todayDate: todayStr,
    },
  });

  console.log('[PulseService] Finished pulse');
}

// ---------------------------------------------------------------------------
// Tick handler
// ---------------------------------------------------------------------------

async function tick(): Promise<void> {
  try {
    const settings = await getSettings();
    if (shouldPulseNow(settings)) {
      queue.push(() => executePulse());
    }
  } catch (err) {
    console.error('[PulseService] Tick error:', err);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function initPulseService(): Promise<void> {
  // Register cleanup callback with cascade module
  registerPulseChatCleanup(async () => {
    const settings = await getSettings();
    if (settings.pulse.chatId) {
      await updateSettings({ pulse: { ...settings.pulse, chatId: null } });
    }
  });

  tickInterval = setInterval(tick, TICK_INTERVAL_MS);
  console.log('[PulseService] Initialized — tick loop running every 60s');
}

export function stopPulseService(): void {
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
}

export async function updatePulseSettings(partial: Partial<PulseSettings>): Promise<PulseSettings> {
  const settings = await getSettings();
  const updated = await updateSettings({ pulse: { ...settings.pulse, ...partial } });
  return updated.pulse;
}

export async function getPulseSettings(): Promise<PulseSettings> {
  const settings = await getSettings();
  return settings.pulse;
}

export async function updatePulseNotes(notes: string): Promise<void> {
  const bounded = notes.slice(0, 2000);
  const settings = await getSettings();
  await updateSettings({ pulse: { ...settings.pulse, notes: bounded } });
}

export function getPulseInfo(settings: AppSettings): {
  remaining: number;
  nextPulseAt: string | null;
  intervalMinutes: number;
} {
  const pulse = settings.pulse;
  const intervalMinutes = getIntervalMinutes(pulse.pulsesPerDay);
  const remaining = Math.max(0, pulse.pulsesPerDay - pulse.pulsesToday);

  let nextPulseAt: string | null = null;
  if (pulse.enabled && pulse.lastPulseAt) {
    const next = new Date(new Date(pulse.lastPulseAt).getTime() + intervalMinutes * 60_000);
    nextPulseAt = next.toISOString();
  } else if (pulse.enabled && !pulse.lastPulseAt) {
    // First pulse: will fire on next tick if conditions are met
    nextPulseAt = 'pending';
  }

  return { remaining, nextPulseAt, intervalMinutes };
}

import cron from 'node-cron';
import { nanoid } from 'nanoid';
import { chatsCol, messagesCol, cronjobsCol } from '../db/index.js';
import { registerCronUnschedule } from '../db/cascade.js';
import { getDecryptedSettings, getThinkingLevelForModel } from './settings.js';
import { buildCombinedPrompt } from './systemInstruction.js';
import { createAIToolCallbacks, type MediaInfo } from './aiTools.js';
import { streamGeminiChat, type GeminiMessage } from './llm/gemini.js';
import { streamOpenAIChat, type OpenAIMessage } from './llm/openai.js';
import type { CronJob } from '../db/schema.js';

// ---------------------------------------------------------------------------
// Async queue — processes one cron execution at a time
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
        console.error('[CronService] Queue task error:', err);
      }
    }
    this.running = false;
  }
}

const queue = new AsyncQueue();

// ---------------------------------------------------------------------------
// In-memory map of scheduled tasks
// ---------------------------------------------------------------------------

const scheduledTasks = new Map<string, cron.ScheduledTask>();

// ---------------------------------------------------------------------------
// Schedule / unschedule helpers
// ---------------------------------------------------------------------------

function scheduleJob(job: CronJob): void {
  // Remove existing task if any
  unscheduleJob(job._id);

  if (!job.enabled) return;

  const task = cron.schedule(job.cronExpression, () => {
    queue.push(() => executeCronJob(job._id));
  }, {
    timezone: job.timezone,
  });

  scheduledTasks.set(job._id, task);
}

function unscheduleJob(jobId: string): void {
  const task = scheduledTasks.get(jobId);
  if (task) {
    task.stop();
    scheduledTasks.delete(jobId);
  }
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

const LLM_TIMEOUT = 120_000; // 120 seconds

async function executeCronJob(jobId: string): Promise<void> {
  // Re-read job from DB (it may have been updated/deleted since scheduling)
  const job = await cronjobsCol.findOne({ _id: jobId });
  if (!job || !job.enabled) return;

  console.log(`[CronService] Executing "${job.name}" (${job.cronExpression})`);

  const settings = await getDecryptedSettings();
  const modelId = settings.primaryModel.modelId;
  const provider = modelId.startsWith('gemini') ? 'gemini' : 'openai';
  const apiKey = settings.apiKeys[provider].apiKey;

  if (!apiKey) {
    console.warn(`[CronService] No API key for ${provider} — skipping execution`);
    return;
  }

  // Verify dedicated chat exists (recreate if deleted)
  let chat = await chatsCol.findOne({ _id: job.chatId });
  if (!chat) {
    const now = new Date();
    await chatsCol.insertOne({
      _id: job.chatId,
      title: `Cron: ${job.name}`,
      provider,
      model: modelId,
      createdAt: now,
      updatedAt: now,
    });
  }

  // Insert instruction as user message
  const userMsgId = nanoid();
  const now = new Date();
  await messagesCol.insertOne({
    _id: userMsgId,
    chatId: job.chatId,
    role: 'user',
    content: job.instruction,
    citations: null,
    createdAt: now,
  });

  // Update chat timestamp
  await chatsCol.updateOne({ _id: job.chatId }, { $set: { updatedAt: now } });

  // Load last 20 messages for context (excluding the one we just inserted)
  const history = await messagesCol
    .find({ chatId: job.chatId })
    .sort({ createdAt: -1 })
    .limit(21)
    .toArray();
  history.reverse();
  // Pop the just-inserted user message
  if (history.length > 0) {
    const last = history[history.length - 1];
    if (last._id === userMsgId) {
      history.pop();
    }
  }

  // Pre-insert empty assistant message
  const assistantMsgId = nanoid();
  await messagesCol.insertOne({
    _id: assistantMsgId,
    chatId: job.chatId,
    role: 'assistant',
    content: '',
    citations: null,
    createdAt: new Date(),
  });

  // Build system prompt
  const systemInstruction = await buildCombinedPrompt();

  const thinkingLevel = getThinkingLevelForModel(settings, modelId);
  const braveApiKey = settings.tools?.braveSearch?.enabled && settings.tools.braveSearch.apiKey
    ? settings.tools.braveSearch.apiKey
    : undefined;

  const onImageGenerated = (media: MediaInfo) => {
    console.log(`[CronService] Image generated for "${job.name}": ${media.mediaId}`);
  };

  const toolCallbacks = createAIToolCallbacks({
    braveApiKey,
    chatId: job.chatId,
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
      console.error(`[CronService] LLM error for "${job.name}":`, err.message);
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
        userMessage: job.instruction,
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
      openAIMessages.push({ role: 'user', content: job.instruction });

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
        console.warn(`[CronService] LLM timeout after ${LLM_TIMEOUT / 1000}s for "${job.name}"`);
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

  // Update lastRunAt
  await cronjobsCol.updateOne(
    { _id: jobId },
    { $set: { lastRunAt: new Date(), updatedAt: new Date() } },
  );

  console.log(`[CronService] Finished "${job.name}"`);
}

// ---------------------------------------------------------------------------
// Public CRUD API
// ---------------------------------------------------------------------------

export async function createCronJob(data: {
  name: string;
  instruction: string;
  cronExpression: string;
  timezone?: string;
}): Promise<CronJob> {
  const settings = await getDecryptedSettings();
  const tz = data.timezone || settings.timezone || 'UTC';
  const modelId = settings.primaryModel.modelId;
  const provider = modelId.startsWith('gemini') ? 'gemini' : 'openai';

  // Validate cron expression
  if (!cron.validate(data.cronExpression)) {
    throw new Error(`Invalid cron expression: ${data.cronExpression}`);
  }

  // Create dedicated chat
  const chatId = nanoid();
  const now = new Date();
  await chatsCol.insertOne({
    _id: chatId,
    title: `Cron: ${data.name}`,
    provider,
    model: modelId,
    createdAt: now,
    updatedAt: now,
  });

  const job: CronJob = {
    _id: nanoid(),
    name: data.name,
    instruction: data.instruction,
    cronExpression: data.cronExpression,
    timezone: tz,
    enabled: true,
    chatId,
    lastRunAt: null,
    nextRunAt: null,
    createdAt: now,
    updatedAt: now,
  };

  await cronjobsCol.insertOne(job);
  scheduleJob(job);

  console.log(`[CronService] Created "${job.name}" (${job.cronExpression} ${tz})`);
  return job;
}

export async function updateCronJob(
  jobId: string,
  updates: Partial<Pick<CronJob, 'name' | 'instruction' | 'cronExpression' | 'timezone' | 'enabled'>>,
): Promise<CronJob | null> {
  // Validate cron expression if provided
  if (updates.cronExpression && !cron.validate(updates.cronExpression)) {
    throw new Error(`Invalid cron expression: ${updates.cronExpression}`);
  }

  const setFields: Record<string, unknown> = { updatedAt: new Date() };
  if (updates.name !== undefined) setFields.name = updates.name;
  if (updates.instruction !== undefined) setFields.instruction = updates.instruction;
  if (updates.cronExpression !== undefined) setFields.cronExpression = updates.cronExpression;
  if (updates.timezone !== undefined) setFields.timezone = updates.timezone;
  if (updates.enabled !== undefined) setFields.enabled = updates.enabled;

  const result = await cronjobsCol.findOneAndUpdate(
    { _id: jobId },
    { $set: setFields },
    { returnDocument: 'after' },
  );

  if (!result) return null;

  // Update chat title if name changed
  if (updates.name !== undefined) {
    await chatsCol.updateOne({ _id: result.chatId }, { $set: { title: `Cron: ${updates.name}` } });
  }

  // Re-schedule
  scheduleJob(result);

  return result;
}

export async function toggleCronJob(jobId: string): Promise<CronJob | null> {
  const job = await cronjobsCol.findOne({ _id: jobId });
  if (!job) return null;

  return updateCronJob(jobId, { enabled: !job.enabled });
}

export async function listCronJobs(): Promise<CronJob[]> {
  return cronjobsCol.find({}).sort({ createdAt: -1 }).toArray();
}

// ---------------------------------------------------------------------------
// Init — load all enabled jobs from DB and schedule them
// ---------------------------------------------------------------------------

export async function initCronService(): Promise<void> {
  // Register the unschedule function with cascade module
  registerCronUnschedule(unscheduleJob);

  const jobs = await cronjobsCol.find({ enabled: true }).toArray();
  for (const job of jobs) {
    scheduleJob(job);
  }
  console.log(`[CronService] Initialized — ${jobs.length} job(s) scheduled`);
}

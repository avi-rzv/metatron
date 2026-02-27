import { whatsapp, type BufferedMessage } from './whatsapp.js';
import { waPermissionsCol, waGroupPermissionsCol, chatsCol, messagesCol } from '../db/index.js';
import { nanoid } from 'nanoid';
import { getDecryptedSettings, getThinkingLevelForModel } from './settings.js';
import { getSystemInstruction, buildWhatsAppPrompt, buildWhatsAppGroupPrompt } from './systemInstruction.js';
import { createAIToolCallbacks, type MediaInfo } from './aiTools.js';
import { streamGeminiChat, type GeminiMessage } from './llm/gemini.js';
import { streamOpenAIChat, type OpenAIMessage } from './llm/openai.js';
import { processIncomingVoice, textToVoiceNote } from './whatsappAudio.js';
import type { WhatsAppPermission, WhatsAppGroupPermission } from '../db/schema.js';

/**
 * Simple async queue that processes one message at a time.
 */
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
        console.error('[WhatsAppAutoReply] Queue task error:', err);
      }
    }
    this.running = false;
  }
}

/**
 * Get or create a dedicated chat session for a WhatsApp contact.
 */
async function getOrCreateContactChat(perm: WhatsAppPermission, settings: { provider: string; model: string }): Promise<string> {
  // Check if permission already has a chatId and the chat still exists
  if (perm.chatId) {
    const existing = await chatsCol.findOne({ _id: perm.chatId });
    if (existing) return perm.chatId;
  }

  // Create a new chat
  const now = new Date();
  const chatId = nanoid();
  await chatsCol.insertOne({
    _id: chatId,
    title: `WhatsApp: ${perm.displayName}`,
    provider: settings.provider,
    model: settings.model,
    createdAt: now,
    updatedAt: now,
  });

  // Link the chat to the permission record
  await waPermissionsCol.updateOne({ _id: perm._id }, { $set: { chatId, updatedAt: now } });

  return chatId;
}

/**
 * Get or create a dedicated chat session for a WhatsApp group.
 */
async function getOrCreateGroupChat(perm: WhatsAppGroupPermission, settings: { provider: string; model: string }): Promise<string> {
  if (perm.chatId) {
    const existing = await chatsCol.findOne({ _id: perm.chatId });
    if (existing) return perm.chatId;
  }

  const now = new Date();
  const chatId = nanoid();
  await chatsCol.insertOne({
    _id: chatId,
    title: `WhatsApp Group: ${perm.groupName}`,
    provider: settings.provider,
    model: settings.model,
    createdAt: now,
    updatedAt: now,
  });

  await waGroupPermissionsCol.updateOne({ _id: perm._id }, { $set: { chatId, updatedAt: now } });

  return chatId;
}

/** Timeout for LLM calls to prevent queue stalls (ms) */
const LLM_TIMEOUT = 90_000; // 90 seconds

/**
 * Run an LLM call (non-streaming) and return the response text.
 * Includes a timeout to prevent the async queue from stalling.
 */
async function runLLM(opts: {
  chatId: string;
  userText: string;
  displayName: string;
  contactId: string | null;
  phoneNumber: string;
  audioAttachment?: { mimeType: string; data: string };
  systemInstructionOverride?: string | null;
}): Promise<string> {
  const settings = await getDecryptedSettings();
  const sysInstr = await getSystemInstruction();

  // Build purpose-built WhatsApp system instruction
  let systemInstruction: string | null;
  if (opts.systemInstructionOverride !== undefined) {
    systemInstruction = opts.systemInstructionOverride;
  } else {
    try {
      systemInstruction = await buildWhatsAppPrompt({
        contactId: opts.contactId,
        phoneNumber: opts.phoneNumber,
        displayName: opts.displayName,
      });
    } catch (err) {
      console.error('[WhatsAppAutoReply] buildWhatsAppPrompt failed, using fallback:', err);
      systemInstruction = `You are Metatron, a personal assistant. You are replying to a WhatsApp message from "${opts.displayName}". Be concise and helpful. Reply in the same language the contact writes in.`;
    }
  }

  // Determine model
  const modelId = settings.primaryModel.modelId;
  const provider = modelId.startsWith('gemini') ? 'gemini' : 'openai';
  const apiKey = settings.apiKeys[provider].apiKey;

  if (!apiKey) {
    console.warn('[WhatsAppAutoReply] No API key for', provider, '— skipping');
    return '';
  }

  console.log(`[WhatsAppAutoReply] Calling ${provider}/${modelId} for "${opts.displayName}"`);

  const thinkingLevel = getThinkingLevelForModel(settings, modelId);
  const braveApiKey = settings.tools?.braveSearch?.enabled && settings.tools.braveSearch.apiKey
    ? settings.tools.braveSearch.apiKey
    : undefined;

  // Load chat history (up to last 20 messages for context).
  // processMessage already inserted the current user message into DB,
  // so we must exclude it to avoid sending it twice to the LLM
  // (which breaks Gemini's alternating user/model requirement).
  const history = await messagesCol
    .find({ chatId: opts.chatId })
    .sort({ createdAt: -1 })
    .limit(21)
    .toArray();
  history.reverse();
  // Pop the last entry if it's the just-inserted user message
  if (history.length > 0) {
    const last = history[history.length - 1];
    if (last.role === 'user' && last.content === opts.userText) {
      history.pop();
    }
  }

  const assistantMsgId = nanoid();

  // Pre-insert assistant message
  await messagesCol.insertOne({
    _id: assistantMsgId,
    chatId: opts.chatId,
    role: 'assistant',
    content: '',
    citations: null,
    createdAt: new Date(),
  });

  // Tool callbacks — full set for auto-reply
  const onImageGenerated = (media: MediaInfo) => {
    console.log(`[WhatsAppAutoReply] Image generated for ${opts.displayName}: ${media.mediaId}`);
  };

  const toolCallbacks = sysInstr.memoryEnabled
    ? createAIToolCallbacks({
        braveApiKey,
        chatId: opts.chatId,
        messageId: assistantMsgId,
        settings,
        onImageGenerated,
      })
    : null;

  let fullContent = '';
  let settled = false;

  const llmPromise = new Promise<string>((resolve) => {
    const settle = (value: string) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const onChunk = (text: string) => { fullContent += text; };
    const onDone = async () => {
      const content = fullContent.trim();
      await messagesCol.updateOne(
        { _id: assistantMsgId },
        { $set: { content } },
      );
      settle(content);
    };
    const onError = async (err: Error) => {
      console.error('[WhatsAppAutoReply] LLM error:', err.message);
      if (!fullContent) {
        await messagesCol.deleteOne({ _id: assistantMsgId });
      } else {
        await messagesCol.updateOne({ _id: assistantMsgId }, { $set: { content: fullContent } });
      }
      settle(fullContent || '');
    };

    if (provider === 'gemini') {
      const geminiHistory: GeminiMessage[] = history.map((m) => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.content }],
      }));

      // Pass audio as inline attachment for Gemini multimodal
      const geminiAttachments = opts.audioAttachment
        ? [{ mimeType: opts.audioAttachment.mimeType, data: opts.audioAttachment.data }]
        : undefined;

      streamGeminiChat({
        apiKey,
        model: modelId,
        thinkingLevel: thinkingLevel.toUpperCase() as 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH',
        history: geminiHistory,
        userMessage: opts.userText,
        attachments: geminiAttachments,
        systemInstruction,
        toolCallbacks,
        onChunk,
        onDone,
        onError,
      }).catch((err) => {
        console.error('[WhatsAppAutoReply] streamGeminiChat rejected:', err);
        onError(err instanceof Error ? err : new Error(String(err)));
      });
    } else {
      const openAIMessages: OpenAIMessage[] = history.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));
      openAIMessages.push({ role: 'user', content: opts.userText });

      // Pass audio as attachment for OpenAI input_audio
      const openaiAttachments = opts.audioAttachment
        ? [{ mimeType: opts.audioAttachment.mimeType, data: opts.audioAttachment.data, name: 'voice_message.ogg' }]
        : undefined;

      streamOpenAIChat({
        apiKey,
        model: modelId,
        reasoningEffort: thinkingLevel as 'minimal' | 'low' | 'medium' | 'high',
        messages: openAIMessages,
        attachments: openaiAttachments,
        systemInstruction,
        toolCallbacks,
        onChunk,
        onDone,
        onError,
      }).catch((err) => {
        console.error('[WhatsAppAutoReply] streamOpenAIChat rejected:', err);
        onError(err instanceof Error ? err : new Error(String(err)));
      });
    }
  });

  // Race against timeout to prevent queue stall
  const timeoutPromise = new Promise<string>((resolve) => {
    setTimeout(() => {
      if (!settled) {
        console.warn(`[WhatsAppAutoReply] LLM timeout after ${LLM_TIMEOUT / 1000}s for "${opts.displayName}"`);
        settled = true;
        // Save partial content if any
        if (fullContent) {
          messagesCol.updateOne({ _id: assistantMsgId }, { $set: { content: fullContent } }).catch(() => {});
        } else {
          messagesCol.deleteOne({ _id: assistantMsgId }).catch(() => {});
        }
      }
      resolve(fullContent || '');
    }, LLM_TIMEOUT);
  });

  return Promise.race([llmPromise, timeoutPromise]);
}

const queue = new AsyncQueue();

async function processMessage(msg: BufferedMessage): Promise<void> {
  // Skip own messages
  if (msg.fromMe) return;

  // --- Group message handling ---
  if (msg.isGroup) {
    return processGroupMessage(msg);
  }

  // --- Contact (DM) message handling ---
  // Normalize sender phone number — strip @s.whatsapp.net suffix first, then non-digits
  const senderPhone = msg.from.replace(/@.*$/, '').replace(/[^0-9]/g, '');
  if (!senderPhone) return;

  // Look up permissions
  const perm = await waPermissionsCol.findOne({ phoneNumber: senderPhone });
  if (!perm) {
    console.log(`[WhatsAppAutoReply] No permission entry for ${senderPhone}, skipping`);
    return;
  }
  if (!perm.canRead) {
    console.log(`[WhatsAppAutoReply] canRead=false for ${perm.displayName} (${senderPhone}), skipping`);
    return;
  }

  console.log(`[WhatsAppAutoReply] Processing message from ${perm.displayName} (${senderPhone}): "${msg.body.slice(0, 80)}"${msg.isVoiceMessage ? ' [VOICE]' : ''}`);

  // Get settings for model info
  const settings = await getDecryptedSettings();
  const modelId = settings.primaryModel.modelId;
  const provider = modelId.startsWith('gemini') ? 'gemini' : 'openai';

  // Process voice messages
  let userText = msg.body;
  let audioAttachment: { mimeType: string; data: string } | undefined;

  if (msg.isVoiceMessage && msg.audioBuffer) {
    try {
      const result = await processIncomingVoice(msg.audioBuffer, msg.audioMimeType ?? 'audio/ogg', settings);
      if (result.type === 'transcript' && result.text) {
        userText = `[Voice message transcript]: ${result.text}`;
        console.log(`[WhatsAppAutoReply] Transcribed voice from ${perm.displayName}: "${result.text.slice(0, 80)}"`);
      } else if (result.type === 'raw' && result.audioBuffer) {
        // Gemini path: pass raw audio as multimodal attachment
        userText = '[Voice message — audio attached]';
        audioAttachment = {
          mimeType: result.audioMimeType ?? 'audio/ogg',
          data: result.audioBuffer.toString('base64'),
        };
        console.log(`[WhatsAppAutoReply] Passing raw audio to Gemini for ${perm.displayName}`);
      }
    } catch (err) {
      console.error('[WhatsAppAutoReply] Voice processing failed, using placeholder text:', err);
      // Fall through with "[Audio message]" as userText
    }
  }

  // Get or create dedicated chat session
  const chatId = await getOrCreateContactChat(perm, { provider, model: modelId });

  // Save incoming WA message as "user" message in the chat
  await messagesCol.insertOne({
    _id: nanoid(),
    chatId,
    role: 'user',
    content: userText,
    citations: null,
    createdAt: new Date(msg.timestamp),
  });

  // Update chat timestamp
  await chatsCol.updateOne({ _id: chatId }, { $set: { updatedAt: new Date() } });

  // Run LLM
  const response = await runLLM({
    chatId,
    userText,
    displayName: perm.displayName,
    contactId: perm.contactId,
    phoneNumber: perm.phoneNumber,
    audioAttachment,
  });

  // If canReply and we got a response, send it via WhatsApp
  if (perm.canReply && response && whatsapp.status === 'connected') {
    // If the incoming message was a voice note, try to reply with voice
    if (msg.isVoiceMessage) {
      try {
        const voiceBuffer = await textToVoiceNote(response, settings);
        await whatsapp.sendVoiceMessage(senderPhone, voiceBuffer);
        console.log(`[WhatsAppAutoReply] Voice-replied to ${perm.displayName} (${voiceBuffer.length} bytes)`);
      } catch (ttsErr) {
        console.error('[WhatsAppAutoReply] TTS failed, falling back to text reply:', ttsErr);
        try {
          await whatsapp.sendMessage(senderPhone, response);
          console.log(`[WhatsAppAutoReply] Text-replied to ${perm.displayName} (TTS fallback): "${response.slice(0, 80)}"`);
        } catch (err) {
          console.error('[WhatsAppAutoReply] Failed to send text fallback reply:', err);
        }
      }
    } else {
      try {
        await whatsapp.sendMessage(senderPhone, response);
        console.log(`[WhatsAppAutoReply] Replied to ${perm.displayName}: "${response.slice(0, 80)}"`);
      } catch (err) {
        console.error('[WhatsAppAutoReply] Failed to send reply:', err);
      }
    }
  } else if (!perm.canReply) {
    console.log(`[WhatsAppAutoReply] canReply=false for ${perm.displayName}, message saved but no reply sent`);
  } else if (!response) {
    console.log(`[WhatsAppAutoReply] Empty LLM response for ${perm.displayName}, no reply sent`);
  } else if (whatsapp.status !== 'connected') {
    console.log(`[WhatsAppAutoReply] WhatsApp disconnected before reply could be sent to ${perm.displayName}`);
  }

  // Release audio buffer after processing to free memory
  msg.audioBuffer = null;
}

async function processGroupMessage(msg: BufferedMessage): Promise<void> {
  // Group JID is in msg.from for group messages
  const groupJid = msg.from;
  if (!groupJid?.includes('@g.us')) return;

  // Look up group permissions
  const groupPerm = await waGroupPermissionsCol.findOne({ groupJid });
  if (!groupPerm) {
    // No permission entry — silently skip
    return;
  }
  if (!groupPerm.canRead) {
    console.log(`[WhatsAppAutoReply] canRead=false for group ${groupPerm.groupName}, skipping`);
    return;
  }

  const senderName = msg.fromName || 'Unknown';
  console.log(`[WhatsAppAutoReply] Processing group message in ${groupPerm.groupName} from ${senderName}: "${msg.body.slice(0, 80)}"`);

  // Get settings for model info
  const settings = await getDecryptedSettings();
  const modelId = settings.primaryModel.modelId;
  const provider = modelId.startsWith('gemini') ? 'gemini' : 'openai';

  const userText = `[${senderName}]: ${msg.body}`;

  // Get or create dedicated chat session for the group
  const chatId = await getOrCreateGroupChat(groupPerm, { provider, model: modelId });

  // Save incoming message
  await messagesCol.insertOne({
    _id: nanoid(),
    chatId,
    role: 'user',
    content: userText,
    citations: null,
    createdAt: new Date(msg.timestamp),
  });

  await chatsCol.updateOne({ _id: chatId }, { $set: { updatedAt: new Date() } });

  // Build group-specific system prompt
  let groupSystemInstruction: string | null;
  try {
    groupSystemInstruction = await buildWhatsAppGroupPrompt({
      groupJid,
      groupName: groupPerm.groupName,
      senderName,
    });
  } catch (err) {
    console.error('[WhatsAppAutoReply] buildWhatsAppGroupPrompt failed, using fallback:', err);
    groupSystemInstruction = `You are Metatron, a personal assistant. You are in a WhatsApp group called "${groupPerm.groupName}". The latest message was sent by ${senderName}. Be concise and helpful. Reply in the same language the group writes in.`;
  }

  // Run LLM with group system instruction
  const response = await runLLM({
    chatId,
    userText,
    displayName: groupPerm.groupName,
    contactId: null,
    phoneNumber: groupJid,
    systemInstructionOverride: groupSystemInstruction,
  });

  // If canReply and we got a response, send it to the group
  if (groupPerm.canReply && response && whatsapp.status === 'connected') {
    try {
      await whatsapp.sendMessage(groupJid, response);
      console.log(`[WhatsAppAutoReply] Replied in group ${groupPerm.groupName}: "${response.slice(0, 80)}"`);
    } catch (err) {
      console.error(`[WhatsAppAutoReply] Failed to send group reply to ${groupPerm.groupName}:`, err);
    }
  } else if (!groupPerm.canReply) {
    console.log(`[WhatsAppAutoReply] canReply=false for group ${groupPerm.groupName}, message saved but no reply sent`);
  } else if (!response) {
    console.log(`[WhatsAppAutoReply] Empty LLM response for group ${groupPerm.groupName}, no reply sent`);
  }
}

export function initWhatsAppAutoReply() {
  whatsapp.on('message', (msg: BufferedMessage) => {
    queue.push(() => processMessage(msg));
  });
  console.log('[WhatsAppAutoReply] Auto-reply service initialized');
}

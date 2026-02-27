import { mediaCol, waPermissionsCol, waGroupPermissionsCol } from '../db/index.js';
import { updateMemory, updateDbSchema } from './systemInstruction.js';
import { executeAIOperation, type MongoOperation } from './mongoValidator.js';
import { braveWebSearch } from './braveSearch.js';
import { generateImage, editImage, saveImageToDisk, loadImageFromDisk } from './imageGeneration.js';
import { whatsapp } from './whatsapp.js';
import { textToVoiceNote } from './whatsappAudio.js';
import { getDecryptedSettings } from './settings.js';
import { createCronJob, updateCronJob, toggleCronJob, listCronJobs } from './cronService.js';
import { deleteCronJob } from '../db/cascade.js';
import { updatePulseSettings, updatePulseNotes, getPulseSettings, getPulseInfo } from './pulseService.js';
import { nanoid } from 'nanoid';
import type { AppSettings, QuietHoursRange, PulseInterval } from './settings.js';

export interface MediaInfo {
  mediaId: string;
  filename: string;
  prompt: string;
  model: string;
}

export interface AIToolCallbacks {
  saveMemory: (memory: string) => Promise<string>;
  dbQuery: (operation: MongoOperation) => Promise<string>;
  updateDbSchema: (schema: string) => Promise<string>;
  webSearch?: (query: string) => Promise<string>;
  generateImage?: (prompt: string, shortDescription: string) => Promise<string>;
  editImage?: (imageId: string, prompt: string, shortDescription: string) => Promise<string>;
  whatsappReadMessages?: (contact: string | undefined, limit: number) => Promise<string>;
  whatsappSendMessage?: (phone: string, message: string, asVoice?: boolean) => Promise<string>;
  whatsappManagePermission?: (action: string, phoneNumber: string, displayName?: string, canRead?: boolean, canReply?: boolean, chatInstructions?: string) => Promise<string>;
  whatsappListPermissions?: () => Promise<string>;
  whatsappListGroups?: () => Promise<string>;
  whatsappManageGroupPermission?: (action: string, groupJid: string, groupName?: string, canRead?: boolean, canReply?: boolean, chatInstructions?: string) => Promise<string>;
  manageCronjob: (action: string, name?: string, instruction?: string, cronExpression?: string, jobId?: string, enabled?: boolean) => Promise<string>;
  managePulse: (action: string, notes?: string, enabled?: boolean, activeDays?: number[], pulsesPerDay?: number, quietHours?: QuietHoursRange[]) => Promise<string>;
}

export interface AIToolOptions {
  braveApiKey?: string;
  chatId?: string;
  messageId?: string;
  settings?: AppSettings;
  onImageGenerated?: (media: MediaInfo) => void;
}

export function createAIToolCallbacks(opts: AIToolOptions = {}): AIToolCallbacks {
  const { braveApiKey, chatId, messageId, settings, onImageGenerated } = opts;
  return {
    async saveMemory(memory: string): Promise<string> {
      try {
        await updateMemory(memory);
        return JSON.stringify({ success: true, message: 'Memory updated successfully' });
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    },

    async dbQuery(operation: MongoOperation): Promise<string> {
      return executeAIOperation(operation);
    },

    async updateDbSchema(schema: string): Promise<string> {
      try {
        await updateDbSchema(schema);
        return JSON.stringify({ success: true, message: 'Schema updated successfully' });
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    },

    ...(braveApiKey
      ? {
          async webSearch(query: string): Promise<string> {
            try {
              const results = await braveWebSearch(braveApiKey, query);
              return JSON.stringify({ results });
            } catch (err) {
              return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
            }
          },
        }
      : {}),

    ...(whatsapp.status === 'connected'
      ? {
          async whatsappReadMessages(contact: string | undefined, limit: number): Promise<string> {
            try {
              const isGroup = contact?.includes('@g.us');

              if (!isGroup) {
                const allPerms = await waPermissionsCol.find({ canRead: true }).toArray();
                const permittedPhones = new Set(allPerms.map(p => p.phoneNumber));

                if (contact) {
                  const normalized = contact.replace(/[^0-9]/g, '');
                  if (!permittedPhones.has(normalized)) {
                    return JSON.stringify({ error: `No read permission for contact ${contact}. Use whatsapp_manage_permission to grant access first.` });
                  }
                }

                let messages = whatsapp.getMessages(contact, limit || 20);

                // Filter to only permitted contacts
                if (!contact) {
                  messages = messages.filter(m => {
                    const fromNum = m.from.replace(/[^0-9]/g, '');
                    const toNum = m.to.replace(/[^0-9]/g, '');
                    return [...permittedPhones].some(p => fromNum.includes(p) || toNum.includes(p));
                  });
                }

                return JSON.stringify({ messages });
              }

              // Group — check group permission
              const groupPerm = await waGroupPermissionsCol.findOne({ groupJid: contact, canRead: true });
              if (!groupPerm) {
                return JSON.stringify({ error: `No read permission for group ${contact}. Use whatsapp_manage_group_permission to grant access first.` });
              }
              const messages = whatsapp.getMessages(contact, limit || 20);
              return JSON.stringify({ messages });
            } catch (err) {
              return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
            }
          },
          async whatsappSendMessage(phone: string, message: string, asVoice?: boolean): Promise<string> {
            try {
              const isGroup = phone.includes('@g.us');
              if (isGroup) {
                const groupPerm = await waGroupPermissionsCol.findOne({ groupJid: phone, canReply: true });
                if (!groupPerm) {
                  return JSON.stringify({ error: `No reply permission for group ${phone}. Use whatsapp_manage_group_permission to grant access first.` });
                }
              } else {
                const normalized = phone.replace(/[^0-9]/g, '');
                // Allow self-messages (to master's own number) without permission check
                const isSelfMessage = whatsapp.phoneNumber && normalized === whatsapp.phoneNumber.replace(/[^0-9]/g, '');
                if (!isSelfMessage) {
                  const perm = await waPermissionsCol.findOne({ phoneNumber: normalized });
                  if (!perm?.canReply) {
                    return JSON.stringify({ error: `No reply permission for ${phone}. Use whatsapp_manage_permission to grant access first.` });
                  }
                }
              }

              if (asVoice) {
                try {
                  const currentSettings = await getDecryptedSettings();
                  const voiceBuffer = await textToVoiceNote(message, currentSettings);
                  const result = await whatsapp.sendVoiceMessage(phone, voiceBuffer);
                  return JSON.stringify({ success: true, jid: result.jid, type: 'voice' });
                } catch (ttsErr) {
                  console.warn('[AITools] TTS failed, falling back to text:', ttsErr instanceof Error ? ttsErr.message : ttsErr);
                  // Fall through to text
                }
              }

              const result = await whatsapp.sendMessage(phone, message);
              return JSON.stringify({ success: true, jid: result.jid, type: 'text' });
            } catch (err) {
              return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
            }
          },
          async whatsappManagePermission(action: string, phoneNumber: string, displayName?: string, canRead?: boolean, canReply?: boolean, chatInstructions?: string): Promise<string> {
            try {
              const normalized = phoneNumber.replace(/[^0-9]/g, '');
              if (!normalized) return JSON.stringify({ error: 'Invalid phone number' });

              switch (action) {
                case 'grant':
                case 'update': {
                  const existing = await waPermissionsCol.findOne({ phoneNumber: normalized });
                  if (existing) {
                    const updates: Record<string, unknown> = { updatedAt: new Date() };
                    if (displayName !== undefined) updates.displayName = displayName;
                    if (canRead !== undefined) updates.canRead = canRead;
                    if (canReply !== undefined) updates.canReply = canReply;
                    if (chatInstructions !== undefined) updates.chatInstructions = chatInstructions;
                    await waPermissionsCol.updateOne({ _id: existing._id }, { $set: updates });
                    return JSON.stringify({ success: true, action: 'updated', phoneNumber: normalized });
                  }
                  // Create new
                  const now = new Date();
                  await waPermissionsCol.insertOne({
                    _id: nanoid(),
                    phoneNumber: normalized,
                    displayName: displayName || normalized,
                    contactId: null,
                    canRead: canRead ?? true,
                    canReply: canReply ?? false,
                    chatInstructions: chatInstructions ?? null,
                    chatId: null,
                    createdAt: now,
                    updatedAt: now,
                  });
                  return JSON.stringify({ success: true, action: 'created', phoneNumber: normalized });
                }
                case 'revoke': {
                  const result = await waPermissionsCol.updateOne(
                    { phoneNumber: normalized },
                    { $set: { canRead: false, canReply: false, updatedAt: new Date() } },
                  );
                  if (result.matchedCount === 0) return JSON.stringify({ error: 'Permission not found for this number' });
                  return JSON.stringify({ success: true, action: 'revoked', phoneNumber: normalized });
                }
                case 'remove': {
                  const result = await waPermissionsCol.deleteOne({ phoneNumber: normalized });
                  if (result.deletedCount === 0) return JSON.stringify({ error: 'Permission not found for this number' });
                  return JSON.stringify({ success: true, action: 'removed', phoneNumber: normalized });
                }
                default:
                  return JSON.stringify({ error: `Unknown action: ${action}. Valid actions: grant, update, revoke, remove` });
              }
            } catch (err) {
              return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
            }
          },
          async whatsappListPermissions(): Promise<string> {
            try {
              const perms = await waPermissionsCol.find({}).sort({ displayName: 1 }).toArray();
              return JSON.stringify({
                permissions: perms.map(p => ({
                  phoneNumber: p.phoneNumber,
                  displayName: p.displayName,
                  canRead: p.canRead,
                  canReply: p.canReply,
                })),
              });
            } catch (err) {
              return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
            }
          },
          async whatsappListGroups(): Promise<string> {
            try {
              const groups = await whatsapp.listGroups();
              return JSON.stringify({ groups });
            } catch (err) {
              return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
            }
          },
          async whatsappManageGroupPermission(action: string, groupJid: string, groupName?: string, canRead?: boolean, canReply?: boolean, chatInstructions?: string): Promise<string> {
            try {
              switch (action) {
                case 'set': {
                  if (!groupJid?.includes('@g.us')) return JSON.stringify({ error: 'Invalid group JID — must contain @g.us' });
                  const existing = await waGroupPermissionsCol.findOne({ groupJid });
                  if (existing) {
                    const updates: Record<string, unknown> = { updatedAt: new Date() };
                    if (groupName !== undefined) updates.groupName = groupName;
                    if (canRead !== undefined) updates.canRead = canRead;
                    if (canReply !== undefined) updates.canReply = canReply;
                    if (chatInstructions !== undefined) updates.chatInstructions = chatInstructions;
                    await waGroupPermissionsCol.updateOne({ _id: existing._id }, { $set: updates });
                    return JSON.stringify({ success: true, action: 'updated', groupJid });
                  }
                  const now = new Date();
                  await waGroupPermissionsCol.insertOne({
                    _id: nanoid(),
                    groupJid,
                    groupName: groupName || groupJid,
                    canRead: canRead ?? true,
                    canReply: canReply ?? false,
                    chatInstructions: chatInstructions ?? null,
                    chatId: null,
                    createdAt: now,
                    updatedAt: now,
                  });
                  return JSON.stringify({ success: true, action: 'created', groupJid });
                }
                case 'list': {
                  const perms = await waGroupPermissionsCol.find({}).sort({ groupName: 1 }).toArray();
                  return JSON.stringify({
                    permissions: perms.map(p => ({
                      groupJid: p.groupJid,
                      groupName: p.groupName,
                      canRead: p.canRead,
                      canReply: p.canReply,
                      chatInstructions: p.chatInstructions,
                    })),
                  });
                }
                case 'remove': {
                  if (!groupJid) return JSON.stringify({ error: 'group_jid is required for remove' });
                  const result = await waGroupPermissionsCol.deleteOne({ groupJid });
                  if (result.deletedCount === 0) return JSON.stringify({ error: 'Group permission not found' });
                  return JSON.stringify({ success: true, action: 'removed', groupJid });
                }
                default:
                  return JSON.stringify({ error: `Unknown action: ${action}. Valid actions: set, list, remove` });
              }
            } catch (err) {
              return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
            }
          },
        }
      : {}),

    async manageCronjob(action: string, name?: string, instruction?: string, cronExpression?: string, jobId?: string, enabled?: boolean): Promise<string> {
      try {
        switch (action) {
          case 'create': {
            if (!name || !instruction || !cronExpression) {
              return JSON.stringify({ error: 'create requires name, instruction, and cronExpression' });
            }
            const job = await createCronJob({ name, instruction, cronExpression });
            return JSON.stringify({ success: true, action: 'created', jobId: job._id, chatId: job.chatId });
          }
          case 'list': {
            const jobs = await listCronJobs();
            return JSON.stringify({
              jobs: jobs.map(j => ({
                jobId: j._id,
                name: j.name,
                instruction: j.instruction,
                cronExpression: j.cronExpression,
                timezone: j.timezone,
                enabled: j.enabled,
                chatId: j.chatId,
                lastRunAt: j.lastRunAt,
              })),
            });
          }
          case 'update': {
            if (!jobId) return JSON.stringify({ error: 'update requires jobId' });
            const updates: Record<string, unknown> = {};
            if (name !== undefined) updates.name = name;
            if (instruction !== undefined) updates.instruction = instruction;
            if (cronExpression !== undefined) updates.cronExpression = cronExpression;
            if (enabled !== undefined) updates.enabled = enabled;
            const updated = await updateCronJob(jobId, updates as any);
            if (!updated) return JSON.stringify({ error: 'Cronjob not found' });
            return JSON.stringify({ success: true, action: 'updated', jobId: updated._id });
          }
          case 'delete': {
            if (!jobId) return JSON.stringify({ error: 'delete requires jobId' });
            const deleted = await deleteCronJob(jobId);
            if (!deleted) return JSON.stringify({ error: 'Cronjob not found' });
            return JSON.stringify({ success: true, action: 'deleted' });
          }
          case 'toggle': {
            if (!jobId) return JSON.stringify({ error: 'toggle requires jobId' });
            const toggled = await toggleCronJob(jobId);
            if (!toggled) return JSON.stringify({ error: 'Cronjob not found' });
            return JSON.stringify({ success: true, action: 'toggled', enabled: toggled.enabled });
          }
          default:
            return JSON.stringify({ error: `Unknown action: ${action}. Valid actions: create, list, update, delete, toggle` });
        }
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    },

    async managePulse(action: string, notes?: string, enabled?: boolean, activeDays?: number[], pulsesPerDay?: number, quietHours?: QuietHoursRange[]): Promise<string> {
      try {
        switch (action) {
          case 'update_notes': {
            if (notes === undefined) return JSON.stringify({ error: 'update_notes requires notes parameter' });
            await updatePulseNotes(notes);
            return JSON.stringify({ success: true, action: 'notes_updated', length: notes.length });
          }
          case 'get_config': {
            const pulseSettings = await getPulseSettings();
            const currentSettings = await getDecryptedSettings();
            const info = getPulseInfo(currentSettings);
            return JSON.stringify({
              ...pulseSettings,
              remaining: info.remaining,
              nextPulseAt: info.nextPulseAt,
              intervalMinutes: info.intervalMinutes,
            });
          }
          case 'update_config': {
            const updates: Record<string, unknown> = {};
            if (enabled !== undefined) updates.enabled = enabled;
            if (activeDays !== undefined) updates.activeDays = activeDays;
            if (pulsesPerDay !== undefined) {
              const validIntervals: PulseInterval[] = [48, 24, 12, 6, 2];
              if (!validIntervals.includes(pulsesPerDay as PulseInterval)) {
                return JSON.stringify({ error: `Invalid pulsesPerDay: ${pulsesPerDay}. Must be one of: ${validIntervals.join(', ')}` });
              }
              updates.pulsesPerDay = pulsesPerDay;
            }
            if (quietHours !== undefined) updates.quietHours = quietHours;
            const updated = await updatePulseSettings(updates as any);
            return JSON.stringify({ success: true, action: 'config_updated', pulse: updated });
          }
          default:
            return JSON.stringify({ error: `Unknown action: ${action}. Valid actions: update_notes, get_config, update_config` });
        }
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    },

    ...(settings && chatId && messageId
      ? {
          async generateImage(prompt: string, shortDescription: string): Promise<string> {
            try {
              const result = await generateImage(prompt, settings);
              const saved = await saveImageToDisk(result.base64, result.mimeType);
              const mediaId = nanoid();
              const desc = shortDescription || prompt.split(/\s+/).slice(0, 5).join(' ');

              await mediaCol.insertOne({
                _id: mediaId,
                chatId,
                messageId,
                filename: saved.filename,
                prompt,
                shortDescription: desc,
                mimeType: result.mimeType,
                size: saved.size,
                model: result.modelUsed,
                sourceMediaId: null,
                createdAt: new Date(),
              });

              onImageGenerated?.({ mediaId, filename: saved.filename, prompt, model: result.modelUsed });

              return JSON.stringify({
                success: true,
                imageId: mediaId,
                message: 'Image generated successfully',
              });
            } catch (err) {
              return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
            }
          },
          async editImage(imageId: string, prompt: string, shortDescription: string): Promise<string> {
            try {
              // Look up source media record
              const sourceMedia = await mediaCol.findOne({ _id: imageId });
              if (!sourceMedia) {
                return JSON.stringify({ error: `Image with id ${imageId} not found` });
              }

              // Load source image from disk
              const source = await loadImageFromDisk(sourceMedia.filename);

              // Edit the image
              const result = await editImage(prompt, source.base64, source.mimeType, settings);
              const saved = await saveImageToDisk(result.base64, result.mimeType);
              const newMediaId = nanoid();
              const desc = shortDescription || prompt.split(/\s+/).slice(0, 5).join(' ');

              await mediaCol.insertOne({
                _id: newMediaId,
                chatId,
                messageId,
                filename: saved.filename,
                prompt,
                shortDescription: desc,
                mimeType: result.mimeType,
                size: saved.size,
                model: result.modelUsed,
                sourceMediaId: sourceMedia._id,
                createdAt: new Date(),
              });

              onImageGenerated?.({ mediaId: newMediaId, filename: saved.filename, prompt, model: result.modelUsed });

              return JSON.stringify({
                success: true,
                imageId: newMediaId,
                message: 'Image edited successfully',
              });
            } catch (err) {
              return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
            }
          },
        }
      : {}),
  };
}

import { chatsCol, messagesCol, mediaCol, attachmentsCol, cronjobsCol, settingsCol, waGroupPermissionsCol } from './index.js';
import { join } from 'path';
import { unlink } from 'fs/promises';

const MEDIA_DIR = './data/media';
const UPLOADS_DIR = './data/uploads';

async function deleteFiles(dir: string, filenames: string[]): Promise<void> {
  await Promise.all(
    filenames.map((f) => unlink(join(dir, f)).catch(() => {}))
  );
}

// Lazy import to avoid circular dependency (cronService imports from db)
let _unscheduleJob: ((jobId: string) => void) | null = null;
export function registerCronUnschedule(fn: (jobId: string) => void) {
  _unscheduleJob = fn;
}

// Lazy import to avoid circular dependency (pulseService imports from db)
let _clearPulseChatId: (() => Promise<void>) | null = null;
export function registerPulseChatCleanup(fn: () => Promise<void>) {
  _clearPulseChatId = fn;
}

/** Delete a chat and all its messages, media (with files), and attachments (with files). */
export async function deleteChat(chatId: string): Promise<void> {
  // Gather filenames before deleting docs
  const mediaDocs = await mediaCol.find({ chatId }, { projection: { filename: 1 } }).toArray();
  const attachmentDocs = await attachmentsCol.find({ chatId }, { projection: { filename: 1 } }).toArray();

  // Delete files from disk
  await Promise.all([
    deleteFiles(MEDIA_DIR, mediaDocs.map((d) => d.filename)),
    deleteFiles(UPLOADS_DIR, attachmentDocs.map((d) => d.filename)),
  ]);

  // Delete documents
  await Promise.all([
    messagesCol.deleteMany({ chatId }),
    mediaCol.deleteMany({ chatId }),
    attachmentsCol.deleteMany({ chatId }),
  ]);
  await chatsCol.deleteOne({ _id: chatId });

  // Unschedule and delete any cronjobs referencing this chat
  const linkedJobs = await cronjobsCol.find({ chatId }).toArray();
  for (const job of linkedJobs) {
    _unscheduleJob?.(job._id);
  }
  if (linkedJobs.length > 0) {
    await cronjobsCol.deleteMany({ chatId });
  }

  // Clear chatId on any group permission referencing this chat
  await waGroupPermissionsCol.updateMany(
    { chatId },
    { $set: { chatId: null, updatedAt: new Date() } },
  );

  // If this was the pulse chat, clear the chatId in settings
  if (_clearPulseChatId) {
    try {
      const raw = await settingsCol.findOne({ _id: 'app_settings' });
      if (raw?.value) {
        const parsed = JSON.parse(raw.value);
        if (parsed.pulse?.chatId === chatId) {
          await _clearPulseChatId();
        }
      }
    } catch {
      // Ignore — pulse cleanup is best-effort
    }
  }
}

/** Delete a cronjob, its dedicated chat (cascade), and unschedule it. */
export async function deleteCronJob(jobId: string): Promise<boolean> {
  const job = await cronjobsCol.findOne({ _id: jobId });
  if (!job) return false;

  _unscheduleJob?.(jobId);

  // Delete the dedicated chat (which cascades messages/media/attachments)
  // But first temporarily remove the cronjob doc so deleteChat doesn't try to re-unschedule
  await cronjobsCol.deleteOne({ _id: jobId });
  await deleteChat(job.chatId);

  return true;
}

/** Delete a message and its media (with files) and attachments (with files). */
export async function deleteMessage(messageId: string): Promise<void> {
  const mediaDocs = await mediaCol.find({ messageId }, { projection: { filename: 1 } }).toArray();
  const attachmentDocs = await attachmentsCol.find({ messageId }, { projection: { filename: 1 } }).toArray();

  await Promise.all([
    deleteFiles(MEDIA_DIR, mediaDocs.map((d) => d.filename)),
    deleteFiles(UPLOADS_DIR, attachmentDocs.map((d) => d.filename)),
  ]);

  await Promise.all([
    mediaCol.deleteMany({ messageId }),
    attachmentsCol.deleteMany({ messageId }),
    messagesCol.deleteOne({ _id: messageId }),
  ]);
}

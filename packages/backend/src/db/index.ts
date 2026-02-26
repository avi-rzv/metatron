import { MongoClient, type Collection, type Db } from 'mongodb';
import type { Chat, Message, Setting, MediaDoc, AttachmentDoc, Master, Contact, ScheduleEvent, WhatsAppPermission, CronJob } from './schema.js';
import { mkdir } from 'fs/promises';

const MONGODB_URI = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017';
const MONGODB_DB = process.env.MONGODB_DB ?? 'metatron';

const client = new MongoClient(MONGODB_URI);
await client.connect();

const database: Db = client.db(MONGODB_DB);

// Typed collection accessors
export const chatsCol: Collection<Chat> = database.collection('chats');
export const messagesCol: Collection<Message> = database.collection('messages');
export const settingsCol: Collection<Setting> = database.collection('settings');
export const mediaCol: Collection<MediaDoc> = database.collection('media');
export const attachmentsCol: Collection<AttachmentDoc> = database.collection('attachments');

// AI-managed collections
export const masterCol: Collection<Master> = database.collection('master');
export const contactsCol: Collection<Contact> = database.collection('contacts');
export const scheduleCol: Collection<ScheduleEvent> = database.collection('schedule');
export const waPermissionsCol: Collection<WhatsAppPermission> = database.collection('whatsapp_permissions');
export const cronjobsCol: Collection<CronJob> = database.collection('cronjobs');

// Create indexes
await Promise.all([
  chatsCol.createIndex({ updatedAt: -1 }),
  messagesCol.createIndex({ chatId: 1, createdAt: 1 }),
  mediaCol.createIndex({ chatId: 1 }),
  mediaCol.createIndex({ messageId: 1 }),
  attachmentsCol.createIndex({ chatId: 1 }),
  attachmentsCol.createIndex({ messageId: 1 }),
  // contacts indexes
  contactsCol.createIndex({ lastName: 1, firstName: 1 }),
  contactsCol.createIndex({ relation: 1 }),
  // schedule indexes
  scheduleCol.createIndex({ dtstart: 1 }),
  scheduleCol.createIndex({ dtend: 1 }),
  scheduleCol.createIndex({ contactId: 1 }),
  scheduleCol.createIndex({ status: 1, dtstart: 1 }),
  // whatsapp_permissions indexes
  waPermissionsCol.createIndex({ phoneNumber: 1 }, { unique: true }),
  waPermissionsCol.createIndex({ contactId: 1 }),
  // cronjobs indexes
  cronjobsCol.createIndex({ enabled: 1 }),
  cronjobsCol.createIndex({ chatId: 1 }),
]);

// Ensure data directories
await mkdir('./data/media', { recursive: true });
await mkdir('./data/uploads', { recursive: true });
await mkdir('./data/whatsapp-auth', { recursive: true });

// Expose client and db for migration script and dynamic AI queries
export { client, database };

// Graceful shutdown
function shutdown() {
  client.close().catch(() => {});
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

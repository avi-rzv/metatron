import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

export const chats = sqliteTable('chats', {
  id: text('id').primaryKey(),
  title: text('title').notNull().default('New Chat'),
  provider: text('provider').notNull().default('gemini'), // 'gemini' | 'openai'
  model: text('model').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  chatId: text('chat_id').notNull().references(() => chats.id, { onDelete: 'cascade' }),
  role: text('role').notNull(), // 'user' | 'assistant'
  content: text('content').notNull(),
  citations: text('citations'), // JSON array of {url, title} or null
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const media = sqliteTable('media', {
  id: text('id').primaryKey(),
  chatId: text('chat_id').notNull().references(() => chats.id, { onDelete: 'cascade' }),
  messageId: text('message_id').notNull().references(() => messages.id, { onDelete: 'cascade' }),
  filename: text('filename').notNull(),
  prompt: text('prompt').notNull(),
  shortDescription: text('short_description').notNull().default(''),
  mimeType: text('mime_type').notNull(),
  size: integer('size').notNull(),
  model: text('model').notNull(),
  sourceMediaId: text('source_media_id'),  // null = generated, set = edited from this ID
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

export type Chat = typeof chats.$inferSelect;
export type NewChat = typeof chats.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export const attachments = sqliteTable('attachments', {
  id: text('id').primaryKey(),
  chatId: text('chat_id').notNull().references(() => chats.id, { onDelete: 'cascade' }),
  messageId: text('message_id').notNull().references(() => messages.id, { onDelete: 'cascade' }),
  filename: text('filename').notNull(),
  originalName: text('original_name').notNull(),
  mimeType: text('mime_type').notNull(),
  size: integer('size').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

export type Media = typeof media.$inferSelect;
export type NewMedia = typeof media.$inferInsert;
export type Attachment = typeof attachments.$inferSelect;
export type NewAttachment = typeof attachments.$inferInsert;

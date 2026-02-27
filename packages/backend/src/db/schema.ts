/** MongoDB document interfaces for MetatronOS */

export interface Chat {
  _id: string;        // nanoid
  title: string;
  provider: string;   // 'gemini' | 'openai'
  model: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Message {
  _id: string;        // nanoid
  chatId: string;
  role: string;       // 'user' | 'assistant'
  content: string;
  citations: Array<{ url: string; title: string }> | null;
  createdAt: Date;
}

export interface Setting {
  _id: string;        // the key string (e.g. 'app_settings')
  value: string;
}

export interface MediaDoc {
  _id: string;        // nanoid
  chatId: string;
  messageId: string;
  filename: string;
  prompt: string;
  shortDescription: string;
  mimeType: string;
  size: number;
  model: string;
  sourceMediaId: string | null;
  createdAt: Date;
}

export interface AttachmentDoc {
  _id: string;        // nanoid
  chatId: string;
  messageId: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  createdAt: Date;
}

// --- AI-managed collection types ---

export type MaritalStatus = 'single' | 'married' | 'engaged' | 'divorced' | 'widowed' | 'other';
export type EventStatus = 'confirmed' | 'tentative' | 'cancelled';

export interface Master {
  _id: string;
  firstName: string | null;
  lastName: string | null;
  dateOfBirth: string | null;   // ISO date string
  gender: string | null;
  maritalStatus: MaritalStatus | null;
  children: number | null;
  profession: string | null;
  phoneNumber: string | null;
  email: string | null;
  street: string | null;
  city: string | null;
  country: string | null;
  zipCode: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Contact {
  _id: string;
  firstName: string | null;
  lastName: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  maritalStatus: MaritalStatus | null;
  children: number | null;
  profession: string | null;
  phoneNumber: string | null;
  email: string | null;
  street: string | null;
  city: string | null;
  country: string | null;
  zipCode: string | null;
  relation: string;             // free-form: father, friend, colleague, etc.
  createdAt: Date;
  updatedAt: Date;
}

export interface ScheduleEvent {
  _id: string;
  title: string;
  description: string | null;
  location: string | null;
  dtstart: Date;
  dtend: Date;
  allDay: boolean;
  rrule: string | null;         // RFC 5545 RRULE string
  status: EventStatus;
  reminder: number | null;      // minutes before event
  contactId: string | null;     // informational link to contacts collection
  createdAt: Date;
  updatedAt: Date;
}

export interface WhatsAppPermission {
  _id: string;           // nanoid
  phoneNumber: string;   // digits only, e.g. "14155551234"
  displayName: string;   // user label, e.g. "Mom"
  contactId: string | null;  // optional link to contacts._id
  canRead: boolean;
  canReply: boolean;
  chatInstructions: string | null; // per-contact AI behavior instructions
  chatId: string | null; // dedicated chat session (created lazily)
  createdAt: Date;
  updatedAt: Date;
}

export interface WhatsAppGroupPermission {
  _id: string;           // nanoid
  groupJid: string;      // e.g. "120363012345678@g.us"
  groupName: string;     // display name from Baileys
  canRead: boolean;
  canReply: boolean;
  chatInstructions: string | null;
  chatId: string | null; // dedicated chat for group auto-reply
  createdAt: Date;
  updatedAt: Date;
}

export interface CronJob {
  _id: string;           // nanoid
  name: string;          // "Daily Israel News"
  instruction: string;   // what the AI does when triggered
  cronExpression: string; // "0 21 * * *"
  timezone: string;      // IANA timezone from settings
  enabled: boolean;
  chatId: string;        // dedicated chat for execution results
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

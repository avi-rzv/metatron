# Database — MongoDB

MetatronOS uses MongoDB as its primary database, accessed through the official Node.js `mongodb` driver (^6.12.0). There is no ORM — all queries use the native driver API directly.

---

## Why MongoDB

- **LLM-friendly**: JSON query syntax is trivial for AI agents to generate (no SQL parsing needed)
- **Document model**: maps naturally to the existing chat/message/settings data
- **Schema flexibility**: no migration files required; collections are created on first write
- **Native arrays**: fields like `citations` store as real arrays instead of JSON-encoded text

---

## Connection (`src/db/index.ts`)

The module connects to MongoDB on import via top-level `await`:

```typescript
const client = new MongoClient(MONGODB_URI);
await client.connect();
const database = client.db(MONGODB_DB);
```

**Environment variables:**

| Variable | Default | Description |
|----------|---------|-------------|
| `MONGODB_URI` | `mongodb://127.0.0.1:27017` | MongoDB connection string |
| `MONGODB_DB` | `metatron` | Database name |

Ten typed collection accessors are exported — five core application collections, four AI-managed collections, and one WhatsApp-specific collection:

```typescript
// Core application collections
export const chatsCol: Collection<Chat>
export const messagesCol: Collection<Message>
export const settingsCol: Collection<Setting>
export const mediaCol: Collection<MediaDoc>
export const attachmentsCol: Collection<AttachmentDoc>

// AI-managed collections
export const masterCol: Collection<Master>
export const contactsCol: Collection<Contact>
export const scheduleCol: Collection<ScheduleEvent>
export const cronjobsCol: Collection<CronJob>

// WhatsApp permission collection
export const waPermissionsCol: Collection<WhatsAppPermission>
```

The raw `client` and `database` are also exported for use by the migration script and AI dynamic queries.

### Indexes

Created on startup via `createIndex()`:

| Collection | Index | Purpose |
|------------|-------|---------|
| `chats` | `{ updatedAt: -1 }` | List chats by most recent activity |
| `messages` | `{ chatId: 1, createdAt: 1 }` | Load messages for a chat in order |
| `media` | `{ chatId: 1 }` | Find all media in a chat |
| `media` | `{ messageId: 1 }` | Find media for a specific message |
| `attachments` | `{ chatId: 1 }` | Find all attachments in a chat |
| `attachments` | `{ messageId: 1 }` | Find attachments for a specific message |
| `contacts` | `{ lastName: 1, firstName: 1 }` | Look up contacts by name |
| `contacts` | `{ relation: 1 }` | Filter contacts by relationship type |
| `schedule` | `{ dtstart: 1 }` | Query events by start time |
| `schedule` | `{ dtend: 1 }` | Query events by end time |
| `schedule` | `{ contactId: 1 }` | Find events linked to a contact |
| `schedule` | `{ status: 1, dtstart: 1 }` | Filter events by status and time |
| `whatsapp_permissions` | `{ phoneNumber: 1 }` (unique) | Look up permission by phone number; enforces uniqueness |
| `whatsapp_permissions` | `{ contactId: 1 }` | Find permissions linked to a contact |
| `cronjobs` | `{ enabled: 1 }` | Find all enabled jobs for scheduling |
| `cronjobs` | `{ chatId: 1 }` | Find cronjobs linked to a specific chat (cascade delete) |

### Graceful shutdown

`SIGINT` and `SIGTERM` handlers call `client.close()` to cleanly disconnect.

### Data directories

The module ensures `./data/media` and `./data/uploads` exist on startup (for generated images and uploaded files).

---

## Schema (`src/db/schema.ts`)

Document interfaces are defined as plain TypeScript interfaces. All `_id` fields use nanoid strings (not MongoDB `ObjectId`).

### Chat

```typescript
interface Chat {
  _id: string;        // nanoid
  title: string;
  provider: string;   // 'gemini' | 'openai'
  model: string;
  createdAt: Date;
  updatedAt: Date;
}
```

### Message

```typescript
interface Message {
  _id: string;
  chatId: string;
  role: string;       // 'user' | 'assistant'
  content: string;
  citations: Array<{ url: string; title: string }> | null;
  createdAt: Date;
}
```

`citations` is stored as a native array — no `JSON.parse()` / `JSON.stringify()` needed.

### Setting

```typescript
interface Setting {
  _id: string;        // the key string (e.g. 'app_settings')
  value: string;
}
```

### MediaDoc

```typescript
interface MediaDoc {
  _id: string;
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
```

### AttachmentDoc

```typescript
interface AttachmentDoc {
  _id: string;
  chatId: string;
  messageId: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  createdAt: Date;
}
```

### AI-managed collection types

These three interfaces define the collections that the AI agent reads from and writes to directly via the `db_query` tool. They share two enum-like type aliases:

```typescript
type MaritalStatus = 'single' | 'married' | 'engaged' | 'divorced' | 'widowed' | 'other';
type EventStatus   = 'confirmed' | 'tentative' | 'cancelled';
```

#### Master

Intended to hold exactly one document — the user's profile. The AI upserts this document as it learns personal details from conversation.

```typescript
interface Master {
  _id: string;
  firstName: string | null;
  lastName: string | null;
  dateOfBirth: string | null;   // ISO date string (YYYY-MM-DD)
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
```

#### Contact

Stores people the user mentions (family, friends, colleagues, etc.). The `relation` field is a free-form string (`"father"`, `"best friend"`, `"manager"`, etc.).

```typescript
interface Contact {
  _id: string;              // nanoid
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
  relation: string;         // required — how the contact relates to the user
  createdAt: Date;
  updatedAt: Date;
}
```

#### ScheduleEvent

Stores calendar events, appointments, reminders, and deadlines.

```typescript
interface ScheduleEvent {
  _id: string;              // nanoid
  title: string;
  description: string | null;
  location: string | null;
  dtstart: Date;            // event start (required)
  dtend: Date;              // event end (required)
  allDay: boolean;          // true for full-day events
  rrule: string | null;     // RFC 5545 RRULE string for recurring events
  status: EventStatus;      // 'confirmed' | 'tentative' | 'cancelled'
  reminder: number | null;  // minutes before event
  contactId: string | null; // informational link to contacts._id
  createdAt: Date;
  updatedAt: Date;
}
```

### WhatsAppPermission

Controls which contacts the AI (and the auto-reply service) is allowed to read from or reply to. One document per phone number.

```typescript
interface WhatsAppPermission {
  _id: string;            // nanoid
  phoneNumber: string;    // digits only, unique (e.g. "14155551234")
  displayName: string;    // user label (e.g. "Mom")
  contactId: string | null;  // optional link to contacts._id
  canRead: boolean;       // AI can read messages from this contact
  canReply: boolean;      // AI can auto-reply to this contact
  chatId: string | null;  // dedicated chat session ID (set lazily by auto-reply service)
  createdAt: Date;
  updatedAt: Date;
}
```

`phoneNumber` has a unique index — duplicate phone numbers are rejected by the database. `chatId` starts as `null` and is populated when the auto-reply service creates a dedicated chat session for the contact.

### CronJob

Stores recurring scheduled tasks. Each cronjob has a dedicated chat where execution results are saved.

```typescript
interface CronJob {
  _id: string;              // nanoid
  name: string;             // human label (e.g. "Daily News Summary")
  instruction: string;      // what the AI does when triggered
  cronExpression: string;   // standard 5-field cron expression (e.g. "0 21 * * *")
  timezone: string;         // IANA timezone from settings at creation time
  enabled: boolean;         // whether the job is actively scheduled
  chatId: string;           // dedicated chat for execution results
  lastRunAt: Date | null;   // updated after each execution
  nextRunAt: Date | null;   // reserved for future use
  createdAt: Date;
  updatedAt: Date;
}
```

`chatId` is set at creation time — a dedicated chat is created for each cronjob. If the chat is deleted externally, the cron service recreates it on the next execution.

---

## ID mapping (`src/db/utils.ts`)

MongoDB documents use `_id` as the primary key, but the frontend API expects `id`. Two helpers handle the conversion:

```typescript
toApiDoc(doc)   // { _id, ...rest } → { id, ...rest }
toApiDocs(docs) // array version
```

All route handlers call these before returning documents to the client.

---

## Cascading deletes (`src/db/cascade.ts`)

MongoDB has no foreign key constraints, so cascading deletes are handled at the application level:

### `deleteChat(chatId)`

1. Finds all media and attachment filenames for the chat
2. Deletes files from disk (`./data/media`, `./data/uploads`)
3. Deletes all messages, media, and attachments documents for the chat
4. Unschedules and deletes any cronjobs that reference this `chatId`
5. Deletes the chat document itself
6. If the deleted chat was the pulse chat, clears `pulse.chatId` in settings (the next pulse will create a fresh chat)

### `deleteCronJob(jobId)`

1. Unschedules the job (removes from the in-memory `node-cron` task map)
2. Deletes the cronjob document
3. Cascade-deletes the dedicated chat via `deleteChat()`

The function deletes the cronjob document before calling `deleteChat()` to prevent `deleteChat()` from trying to re-unschedule the already-removed job.

Two deferred registration functions break circular dependencies:
- `registerCronUnschedule(fn)` — called by `cronService.ts` at startup to register its `unscheduleJob` function
- `registerPulseChatCleanup(fn)` — called by `pulseService.ts` at startup to register a function that clears `pulse.chatId` in settings

### `deleteMessage(messageId)`

1. Finds all media and attachment filenames for the message
2. Deletes files from disk
3. Deletes media, attachments, and the message document

All delete functions remove disk files in parallel for performance, and silently ignore missing files.

---

## Common query patterns

```typescript
// Find all, sorted
await chatsCol.find().sort({ updatedAt: -1 }).toArray()

// Find one by ID
await chatsCol.findOne({ _id: id })

// Insert
await messagesCol.insertOne({ _id: nanoid(), chatId, role, content, citations: null, createdAt: new Date() })

// Upsert (used for settings)
await settingsCol.updateOne({ _id: key }, { $set: { value } }, { upsert: true })

// Update
await chatsCol.updateOne({ _id: id }, { $set: { title, updatedAt: new Date() } })

// Delete
await chatsCol.deleteOne({ _id: id })

// Count
await messagesCol.countDocuments({ chatId })
```

---

## AI sandbox (`src/services/mongoValidator.ts`)

The AI can execute MongoDB operations through the `db_query` tool. Operations are structured JSON objects (not raw query strings):

```typescript
interface MongoOperation {
  operation: string;     // find, insertOne, updateOne, etc.
  collection: string;    // target collection name
  filter?: object;       // query filter
  data?: object;         // document(s) to insert
  update?: object;       // update operations ($set, $push, etc.)
  sort?: object;
  limit?: number;
  // ... other fields
}
```

### Allowed operations

`find`, `findOne`, `insertOne`, `insertMany`, `updateOne`, `updateMany`, `deleteOne`, `deleteMany`, `countDocuments`, `aggregate`, `createCollection`, `createIndex`, `listCollections`

### Access control

Three tiers of access are enforced by `validateMongoOperation()`:

| Tier | Collections | AI read | AI write |
|------|-------------|---------|----------|
| Protected | `chats`, `messages`, `settings`, `media`, `attachments` | Yes | No |
| AI-managed | `master`, `contacts`, `schedule`, `cronjobs` | Yes | Yes |
| Custom AI | any `ai_`-prefixed name | Yes | Yes |

- **Protected collections** are core application data and are read-only for the AI. Any write attempt returns an `Access denied` error.
- **AI-managed collections** (`master`, `contacts`, `schedule`, `cronjobs`) are built-in collections with predefined schemas. The AI has full read/write access without needing the `ai_` prefix. The `cronjobs` collection is primarily accessed through the `manage_cronjob` AI tool rather than `db_query`.
- **Custom AI collections** must use the `ai_` prefix (e.g., `ai_notes`, `ai_projects`). The AI can create these on demand via `createCollection` and document them with `update_db_schema`.
- The AI can read from any collection in the database.

---

## Migration from SQLite

A one-time migration script is provided for existing deployments:

```bash
npm run migrate:sqlite-to-mongo --workspace=packages/backend
```

The script (`src/scripts/migrate-sqlite-to-mongo.ts`):
1. Opens the SQLite database in read-only mode
2. Reads all rows from the 5 core tables
3. Converts: `id` → `_id`, snake_case timestamps → Date objects, `citations` JSON text → native arrays
4. Inserts into the corresponding MongoDB collections
5. Migrates any `ai_`-prefixed tables (preserving their structure)

Safe to run multiple times — duplicate documents are skipped via `ordered: false` insert.

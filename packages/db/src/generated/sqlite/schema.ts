import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Sync metadata table for tracking entity sync status.
 * Designed for future cloud sync capabilities.
 */
export const syncMetadata = sqliteTable(
  'sync_metadata',
  {
    id: text('id').primaryKey(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    version: integer('version').notNull().default(0),
    lastModified: integer('last_modified', { mode: 'timestamp_ms' }).notNull(),
    syncStatus: text('sync_status', {
      enum: ['pending', 'synced', 'conflict']
    })
      .notNull()
      .default('pending'),
    deleted: integer('deleted', { mode: 'boolean' }).notNull().default(false)
  },
  (table) => [
    index('entity_idx').on(table.entityType, table.entityId),
    index('sync_status_idx').on(table.syncStatus)
  ]
);

/**
 * User settings table for storing encrypted user preferences.
 */
export const userSettings = sqliteTable('user_settings', {
  key: text('key').primaryKey(),
  value: text('value'),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
});

/**
 * Users table for core identity records.
 */
export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    emailConfirmed: integer('email_confirmed', { mode: 'boolean' })
      .notNull()
      .default(false)
  },
  (table) => [index('users_email_idx').on(table.email)]
);

/**
 * User credentials table for password authentication.
 */
export const userCredentials = sqliteTable('user_credentials', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  passwordHash: text('password_hash').notNull(),
  passwordSalt: text('password_salt').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
});

/**
 * Migrations table to track applied database migrations.
 */
export const migrations = sqliteTable('schema_migrations', {
  version: integer('version').primaryKey(),
  appliedAt: integer('applied_at', { mode: 'timestamp_ms' }).notNull()
});

/**
 * Key-value store for encrypted secrets (tokens, credentials).
 */
export const secrets = sqliteTable('secrets', {
  key: text('key').primaryKey(),
  encryptedValue: text('encrypted_value').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
});

/**
 * Files metadata table for tracking encrypted file storage in OPFS.
 */
export const files = sqliteTable(
  'files',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    size: integer('size').notNull(),
    mimeType: text('mime_type').notNull(),
    uploadDate: integer('upload_date', { mode: 'timestamp_ms' }).notNull(),
    contentHash: text('content_hash').notNull(),
    storagePath: text('storage_path').notNull(),
    thumbnailPath: text('thumbnail_path'),
    deleted: integer('deleted', { mode: 'boolean' }).notNull().default(false)
  },
  (table) => [
    index('files_content_hash_idx').on(table.contentHash),
    index('files_upload_date_idx').on(table.uploadDate)
  ]
);

/**
 * Contacts table for storing contact information.
 */
export const contacts = sqliteTable(
  'contacts',
  {
    id: text('id').primaryKey(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name'),
    birthday: text('birthday'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
    deleted: integer('deleted', { mode: 'boolean' }).notNull().default(false)
  },
  (table) => [index('contacts_first_name_idx').on(table.firstName)]
);

/**
 * Contact phone numbers (multiple per contact).
 */
export const contactPhones = sqliteTable(
  'contact_phones',
  {
    id: text('id').primaryKey(),
    contactId: text('contact_id').notNull(),
    phoneNumber: text('phone_number').notNull(),
    label: text('label'),
    isPrimary: integer('is_primary', { mode: 'boolean' })
      .notNull()
      .default(false)
  },
  (table) => [index('contact_phones_contact_idx').on(table.contactId)]
);

/**
 * Contact email addresses (multiple per contact).
 */
export const contactEmails = sqliteTable(
  'contact_emails',
  {
    id: text('id').primaryKey(),
    contactId: text('contact_id').notNull(),
    email: text('email').notNull(),
    label: text('label'),
    isPrimary: integer('is_primary', { mode: 'boolean' })
      .notNull()
      .default(false)
  },
  (table) => [
    index('contact_emails_contact_idx').on(table.contactId),
    index('contact_emails_email_idx').on(table.email)
  ]
);

/**
 * Analytics events table for tracking database operations.
 * Used for time series analysis of operation durations.
 */
export const analyticsEvents = sqliteTable(
  'analytics_events',
  {
    id: text('id').primaryKey(),
    eventName: text('event_name').notNull(),
    durationMs: integer('duration_ms').notNull(),
    success: integer('success', { mode: 'boolean' }).notNull(),
    timestamp: integer('timestamp', { mode: 'timestamp_ms' }).notNull(),
    detail: text('detail')
  },
  (table) => [index('analytics_events_timestamp_idx').on(table.timestamp)]
);

/**
 * Notes table for storing user notes with markdown content.
 */
export const notes = sqliteTable(
  'notes',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    content: text('content').notNull().default(''),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
    deleted: integer('deleted', { mode: 'boolean' }).notNull().default(false)
  },
  (table) => [
    index('notes_updated_at_idx').on(table.updatedAt),
    index('notes_title_idx').on(table.title)
  ]
);

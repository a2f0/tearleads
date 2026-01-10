import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp
} from 'drizzle-orm/pg-core';

/**
 * Sync metadata table for tracking entity sync status.
 * Designed for future cloud sync capabilities.
 */
export const syncMetadata = pgTable(
  'sync_metadata',
  {
    id: text('id').primaryKey(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    version: integer('version').notNull().default(0),
    lastModified: timestamp('last_modified', { withTimezone: true }).notNull(),
    syncStatus: text('sync_status', {
      enum: ['pending', 'synced', 'conflict']
    })
      .notNull()
      .default('pending'),
    deleted: boolean('deleted').notNull().default(false)
  },
  (table) => [
    index('entity_idx').on(table.entityType, table.entityId),
    index('sync_status_idx').on(table.syncStatus)
  ]
);

/**
 * User settings table for storing encrypted user preferences.
 */
export const userSettings = pgTable('user_settings', {
  key: text('key').primaryKey(),
  value: text('value'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull()
});

/**
 * Migrations table to track applied database migrations.
 */
export const migrations = pgTable('schema_migrations', {
  version: integer('version').primaryKey(),
  appliedAt: timestamp('applied_at', { withTimezone: true }).notNull()
});

/**
 * Key-value store for encrypted secrets (tokens, credentials).
 */
export const secrets = pgTable('secrets', {
  key: text('key').primaryKey(),
  encryptedValue: text('encrypted_value').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull()
});

/**
 * Files metadata table for tracking encrypted file storage in OPFS.
 */
export const files = pgTable(
  'files',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    size: integer('size').notNull(),
    mimeType: text('mime_type').notNull(),
    uploadDate: timestamp('upload_date', { withTimezone: true }).notNull(),
    contentHash: text('content_hash').notNull(),
    storagePath: text('storage_path').notNull(),
    thumbnailPath: text('thumbnail_path'),
    deleted: boolean('deleted').notNull().default(false)
  },
  (table) => [
    index('files_content_hash_idx').on(table.contentHash),
    index('files_upload_date_idx').on(table.uploadDate)
  ]
);

/**
 * Contacts table for storing contact information.
 */
export const contacts = pgTable(
  'contacts',
  {
    id: text('id').primaryKey(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name'),
    birthday: text('birthday'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    deleted: boolean('deleted').notNull().default(false)
  },
  (table) => [index('contacts_first_name_idx').on(table.firstName)]
);

/**
 * Contact phone numbers (multiple per contact).
 */
export const contactPhones = pgTable(
  'contact_phones',
  {
    id: text('id').primaryKey(),
    contactId: text('contact_id').notNull(),
    phoneNumber: text('phone_number').notNull(),
    label: text('label'),
    isPrimary: boolean('is_primary').notNull().default(false)
  },
  (table) => [index('contact_phones_contact_idx').on(table.contactId)]
);

/**
 * Contact email addresses (multiple per contact).
 */
export const contactEmails = pgTable(
  'contact_emails',
  {
    id: text('id').primaryKey(),
    contactId: text('contact_id').notNull(),
    email: text('email').notNull(),
    label: text('label'),
    isPrimary: boolean('is_primary').notNull().default(false)
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
export const analyticsEvents = pgTable(
  'analytics_events',
  {
    id: text('id').primaryKey(),
    eventName: text('event_name').notNull(),
    durationMs: integer('duration_ms').notNull(),
    success: boolean('success').notNull(),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull()
  },
  (table) => [index('analytics_events_timestamp_idx').on(table.timestamp)]
);

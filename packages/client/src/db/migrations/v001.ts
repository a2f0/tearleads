import type { Migration } from './types';

/**
 * v001: Initial schema
 *
 * Creates all base tables for the application:
 * - sync_metadata: Entity sync status tracking
 * - user_settings: Encrypted user preferences
 * - schema_migrations: Migration version tracking
 * - secrets: Encrypted tokens and credentials
 * - files: File metadata for OPFS storage
 * - contacts: Contact information
 * - contact_phones: Contact phone numbers
 * - contact_emails: Contact email addresses
 * - analytics_events: Database operation analytics
 */
export const v001: Migration = {
  version: 1,
  description: 'Initial schema with all base tables',
  up: async (adapter) => {
    const statements = [
      `CREATE TABLE IF NOT EXISTS "sync_metadata" (
        "id" TEXT PRIMARY KEY NOT NULL,
        "entity_type" TEXT NOT NULL,
        "entity_id" TEXT NOT NULL,
        "version" INTEGER DEFAULT 0 NOT NULL,
        "last_modified" INTEGER NOT NULL,
        "sync_status" TEXT DEFAULT 'pending' NOT NULL,
        "deleted" INTEGER DEFAULT 0 NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS "entity_idx" ON "sync_metadata" ("entity_type", "entity_id")`,
      `CREATE INDEX IF NOT EXISTS "sync_status_idx" ON "sync_metadata" ("sync_status")`,
      `CREATE TABLE IF NOT EXISTS "user_settings" (
        "key" TEXT PRIMARY KEY NOT NULL,
        "value" TEXT,
        "updated_at" INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS "schema_migrations" (
        "version" INTEGER PRIMARY KEY NOT NULL,
        "applied_at" INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS "secrets" (
        "key" TEXT PRIMARY KEY NOT NULL,
        "encrypted_value" TEXT NOT NULL,
        "created_at" INTEGER NOT NULL,
        "updated_at" INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS "files" (
        "id" TEXT PRIMARY KEY NOT NULL,
        "name" TEXT NOT NULL,
        "size" INTEGER NOT NULL,
        "mime_type" TEXT NOT NULL,
        "upload_date" INTEGER NOT NULL,
        "content_hash" TEXT NOT NULL,
        "storage_path" TEXT NOT NULL,
        "thumbnail_path" TEXT,
        "deleted" INTEGER DEFAULT 0 NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS "files_content_hash_idx" ON "files" ("content_hash")`,
      `CREATE INDEX IF NOT EXISTS "files_upload_date_idx" ON "files" ("upload_date")`,
      `CREATE TABLE IF NOT EXISTS "contacts" (
        "id" TEXT PRIMARY KEY NOT NULL,
        "first_name" TEXT NOT NULL,
        "last_name" TEXT,
        "birthday" TEXT,
        "created_at" INTEGER NOT NULL,
        "updated_at" INTEGER NOT NULL,
        "deleted" INTEGER DEFAULT 0 NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS "contacts_first_name_idx" ON "contacts" ("first_name")`,
      `CREATE TABLE IF NOT EXISTS "contact_phones" (
        "id" TEXT PRIMARY KEY NOT NULL,
        "contact_id" TEXT NOT NULL,
        "phone_number" TEXT NOT NULL,
        "label" TEXT,
        "is_primary" INTEGER DEFAULT 0 NOT NULL,
        FOREIGN KEY("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE
      )`,
      `CREATE INDEX IF NOT EXISTS "contact_phones_contact_idx" ON "contact_phones" ("contact_id")`,
      `CREATE TABLE IF NOT EXISTS "contact_emails" (
        "id" TEXT PRIMARY KEY NOT NULL,
        "contact_id" TEXT NOT NULL,
        "email" TEXT NOT NULL,
        "label" TEXT,
        "is_primary" INTEGER DEFAULT 0 NOT NULL,
        FOREIGN KEY("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE
      )`,
      `CREATE INDEX IF NOT EXISTS "contact_emails_contact_idx" ON "contact_emails" ("contact_id")`,
      `CREATE INDEX IF NOT EXISTS "contact_emails_email_idx" ON "contact_emails" ("email")`,
      `CREATE TABLE IF NOT EXISTS "analytics_events" (
        "id" TEXT PRIMARY KEY NOT NULL,
        "event_name" TEXT NOT NULL,
        "duration_ms" INTEGER NOT NULL,
        "success" INTEGER NOT NULL,
        "timestamp" INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS "analytics_events_timestamp_idx" ON "analytics_events" ("timestamp")`
    ];

    await adapter.executeMany(statements);
  }
};

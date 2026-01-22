import type { Pool } from 'pg';
import type { Migration } from './types.js';

/**
 * v001: Initial schema
 *
 * Creates all base tables for the PostgreSQL database:
 * - sync_metadata: Entity sync status tracking
 * - user_settings: User preferences
 * - users: Core identity records
 * - user_credentials: Password authentication
 * - schema_migrations: Migration version tracking
 * - secrets: Encrypted tokens and credentials
 * - files: File metadata
 * - contacts: Contact information
 * - contact_phones: Contact phone numbers
 * - contact_emails: Contact email addresses
 * - analytics_events: Database operation analytics
 * - notes: User notes with markdown content
 */
export const v001: Migration = {
  version: 1,
  description: 'Initial schema with all base tables',
  up: async (pool: Pool) => {
    const statements = [
      // Schema migrations table (must be first)
      `CREATE TABLE IF NOT EXISTS "schema_migrations" (
        "version" INTEGER PRIMARY KEY,
        "applied_at" TIMESTAMPTZ NOT NULL
      )`,

      // Sync metadata
      `CREATE TABLE IF NOT EXISTS "sync_metadata" (
        "id" TEXT PRIMARY KEY,
        "entity_type" TEXT NOT NULL,
        "entity_id" TEXT NOT NULL,
        "version" INTEGER NOT NULL DEFAULT 0,
        "last_modified" TIMESTAMPTZ NOT NULL,
        "sync_status" TEXT NOT NULL DEFAULT 'pending',
        "deleted" BOOLEAN NOT NULL DEFAULT FALSE
      )`,
      `CREATE INDEX IF NOT EXISTS "entity_idx" ON "sync_metadata" ("entity_type", "entity_id")`,
      `CREATE INDEX IF NOT EXISTS "sync_status_idx" ON "sync_metadata" ("sync_status")`,

      // User settings
      `CREATE TABLE IF NOT EXISTS "user_settings" (
        "key" TEXT PRIMARY KEY,
        "value" TEXT,
        "updated_at" TIMESTAMPTZ NOT NULL
      )`,

      // Users
      `CREATE TABLE IF NOT EXISTS "users" (
        "id" TEXT PRIMARY KEY,
        "email" TEXT NOT NULL,
        "email_confirmed" BOOLEAN NOT NULL DEFAULT FALSE
      )`,
      `CREATE INDEX IF NOT EXISTS "users_email_idx" ON "users" ("email")`,

      // User credentials
      `CREATE TABLE IF NOT EXISTS "user_credentials" (
        "user_id" TEXT PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
        "password_hash" TEXT NOT NULL,
        "password_salt" TEXT NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL,
        "updated_at" TIMESTAMPTZ NOT NULL
      )`,

      // Secrets
      `CREATE TABLE IF NOT EXISTS "secrets" (
        "key" TEXT PRIMARY KEY,
        "encrypted_value" TEXT NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL,
        "updated_at" TIMESTAMPTZ NOT NULL
      )`,

      // Files
      `CREATE TABLE IF NOT EXISTS "files" (
        "id" TEXT PRIMARY KEY,
        "name" TEXT NOT NULL,
        "size" INTEGER NOT NULL,
        "mime_type" TEXT NOT NULL,
        "upload_date" TIMESTAMPTZ NOT NULL,
        "content_hash" TEXT NOT NULL,
        "storage_path" TEXT NOT NULL,
        "thumbnail_path" TEXT,
        "deleted" BOOLEAN NOT NULL DEFAULT FALSE
      )`,
      `CREATE INDEX IF NOT EXISTS "files_content_hash_idx" ON "files" ("content_hash")`,
      `CREATE INDEX IF NOT EXISTS "files_upload_date_idx" ON "files" ("upload_date")`,

      // Contacts
      `CREATE TABLE IF NOT EXISTS "contacts" (
        "id" TEXT PRIMARY KEY,
        "first_name" TEXT NOT NULL,
        "last_name" TEXT,
        "birthday" TEXT,
        "created_at" TIMESTAMPTZ NOT NULL,
        "updated_at" TIMESTAMPTZ NOT NULL,
        "deleted" BOOLEAN NOT NULL DEFAULT FALSE
      )`,
      `CREATE INDEX IF NOT EXISTS "contacts_first_name_idx" ON "contacts" ("first_name")`,

      // Contact phones
      `CREATE TABLE IF NOT EXISTS "contact_phones" (
        "id" TEXT PRIMARY KEY,
        "contact_id" TEXT NOT NULL,
        "phone_number" TEXT NOT NULL,
        "label" TEXT,
        "is_primary" BOOLEAN NOT NULL DEFAULT FALSE
      )`,
      `CREATE INDEX IF NOT EXISTS "contact_phones_contact_idx" ON "contact_phones" ("contact_id")`,

      // Contact emails
      `CREATE TABLE IF NOT EXISTS "contact_emails" (
        "id" TEXT PRIMARY KEY,
        "contact_id" TEXT NOT NULL,
        "email" TEXT NOT NULL,
        "label" TEXT,
        "is_primary" BOOLEAN NOT NULL DEFAULT FALSE
      )`,
      `CREATE INDEX IF NOT EXISTS "contact_emails_contact_idx" ON "contact_emails" ("contact_id")`,
      `CREATE INDEX IF NOT EXISTS "contact_emails_email_idx" ON "contact_emails" ("email")`,

      // Analytics events
      `CREATE TABLE IF NOT EXISTS "analytics_events" (
        "id" TEXT PRIMARY KEY,
        "event_name" TEXT NOT NULL,
        "duration_ms" INTEGER NOT NULL,
        "success" BOOLEAN NOT NULL,
        "timestamp" TIMESTAMPTZ NOT NULL,
        "detail" JSONB
      )`,
      `CREATE INDEX IF NOT EXISTS "analytics_events_timestamp_idx" ON "analytics_events" ("timestamp")`,

      // Notes
      `CREATE TABLE IF NOT EXISTS "notes" (
        "id" TEXT PRIMARY KEY,
        "title" TEXT NOT NULL,
        "content" TEXT NOT NULL DEFAULT '',
        "created_at" TIMESTAMPTZ NOT NULL,
        "updated_at" TIMESTAMPTZ NOT NULL,
        "deleted" BOOLEAN NOT NULL DEFAULT FALSE
      )`,
      `CREATE INDEX IF NOT EXISTS "notes_updated_at_idx" ON "notes" ("updated_at")`,
      `CREATE INDEX IF NOT EXISTS "notes_title_idx" ON "notes" ("title")`
    ];

    for (const sql of statements) {
      await pool.query(sql);
    }
  }
};

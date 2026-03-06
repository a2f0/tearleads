import type { Migration } from './types';

/**
 * v011: Add contact groups, tags, and emails tables
 *
 * Adds missing VFS extension tables required for name lookups:
 * - contact_groups (contactGroup)
 * - tags (tag)
 * - emails (email)
 */
export const v011: Migration = {
  version: 11,
  description: 'Add VFS tables for contact groups, emails, tags, and folders',
  up: async (adapter) => {
    const statements = [
      `CREATE TABLE IF NOT EXISTS "contact_groups" (
        "id" TEXT PRIMARY KEY NOT NULL REFERENCES "vfs_registry"("id") ON DELETE CASCADE,
        "encrypted_name" TEXT,
        "color" TEXT,
        "icon" TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS "tags" (
        "id" TEXT PRIMARY KEY NOT NULL REFERENCES "vfs_registry"("id") ON DELETE CASCADE,
        "encrypted_name" TEXT,
        "color" TEXT,
        "icon" TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS "emails" (
        "id" TEXT PRIMARY KEY NOT NULL REFERENCES "vfs_registry"("id") ON DELETE CASCADE,
        "encrypted_subject" TEXT,
        "encrypted_from" TEXT,
        "encrypted_to" TEXT,
        "encrypted_cc" TEXT,
        "encrypted_body_path" TEXT,
        "received_at" INTEGER NOT NULL,
        "is_read" INTEGER NOT NULL DEFAULT 0 CHECK("is_read" IN (0, 1)),
        "is_starred" INTEGER NOT NULL DEFAULT 0 CHECK("is_starred" IN (0, 1))
      )`,
      `CREATE INDEX IF NOT EXISTS "emails_received_at_idx" ON "emails" ("received_at")`
    ];

    await adapter.executeMany(statements);
  }
};

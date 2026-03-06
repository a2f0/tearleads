import type { Migration } from './types';

/**
 * v014: Add composed email draft tables
 *
 * Adds local tables used by the Email composer for draft persistence:
 * - composed_emails
 * - email_attachments
 */
export const v014: Migration = {
  version: 14,
  description: 'Add composed_emails and email_attachments tables',
  up: async (adapter) => {
    const statements = [
      `CREATE TABLE IF NOT EXISTS "composed_emails" (
        "id" TEXT PRIMARY KEY NOT NULL REFERENCES "vfs_registry"("id") ON DELETE CASCADE,
        "encrypted_to" TEXT,
        "encrypted_cc" TEXT,
        "encrypted_bcc" TEXT,
        "encrypted_subject" TEXT,
        "encrypted_body" TEXT,
        "status" TEXT NOT NULL DEFAULT 'draft' CHECK("status" IN ('draft', 'sending', 'sent', 'failed')),
        "sent_at" INTEGER,
        "created_at" INTEGER NOT NULL,
        "updated_at" INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS "composed_emails_status_idx" ON "composed_emails" ("status")`,
      `CREATE INDEX IF NOT EXISTS "composed_emails_updated_idx" ON "composed_emails" ("updated_at")`,
      `CREATE TABLE IF NOT EXISTS "email_attachments" (
        "id" TEXT PRIMARY KEY NOT NULL,
        "composed_email_id" TEXT NOT NULL REFERENCES "composed_emails"("id") ON DELETE CASCADE,
        "encrypted_file_name" TEXT NOT NULL,
        "mime_type" TEXT NOT NULL,
        "size" INTEGER NOT NULL,
        "encrypted_storage_path" TEXT NOT NULL,
        "created_at" INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS "email_attachments_email_idx" ON "email_attachments" ("composed_email_id")`
    ];

    await adapter.executeMany(statements);
  }
};

import type { Pool } from 'pg';
import type { Migration } from './types.js';

/**
 * Migration v024: Add inbound SMTP encrypted message tables.
 *
 * Creates:
 * - email_messages: message-level encrypted blob metadata
 * - email_recipients: recipient fanout + wrapped DEK per user
 */
export const v024: Migration = {
  version: 24,
  description:
    'Add inbound SMTP encrypted message tables (email_messages, email_recipients)',
  up: async (pool: Pool) => {
    await pool.query('BEGIN');
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS "email_messages" (
          "id" TEXT PRIMARY KEY,
          "storage_key" TEXT NOT NULL UNIQUE,
          "sha256" TEXT NOT NULL,
          "ciphertext_size" INTEGER NOT NULL CHECK ("ciphertext_size" >= 0),
          "ciphertext_content_type" TEXT NOT NULL DEFAULT 'message/rfc822',
          "content_encryption_algorithm" TEXT NOT NULL DEFAULT 'aes-256-gcm',
          "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS "email_recipients" (
          "id" TEXT PRIMARY KEY,
          "message_id" TEXT NOT NULL REFERENCES "email_messages"("id") ON DELETE CASCADE,
          "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
          "smtp_recipient_address" TEXT NOT NULL,
          "wrapped_dek" TEXT NOT NULL,
          "key_encryption_algorithm" TEXT NOT NULL DEFAULT 'x25519-mlkem768-hybrid-v1',
          "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE ("message_id", "user_id")
        )
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS "email_recipients_user_created_idx"
          ON "email_recipients" ("user_id", "created_at" DESC)
      `);

      await pool.query('COMMIT');
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  }
};

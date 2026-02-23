import type { Pool } from 'pg';
import type { Migration } from './types.js';

/**
 * Migration v024: Add inbound SMTP encrypted message tables and canonical VFS
 * item-state persistence for non-blob CRDT operations.
 */
export const v024: Migration = {
  version: 24,
  description:
    'Add inbound SMTP encrypted message tables and canonical VFS item-state CRDT op types',
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

      await pool.query(`
        CREATE TABLE IF NOT EXISTS "vfs_item_state" (
          "item_id" TEXT PRIMARY KEY REFERENCES "vfs_registry"("id") ON DELETE CASCADE,
          "encrypted_payload" TEXT,
          "key_epoch" INTEGER,
          "encryption_nonce" TEXT,
          "encryption_aad" TEXT,
          "encryption_signature" TEXT,
          "updated_at" TIMESTAMPTZ NOT NULL,
          "deleted_at" TIMESTAMPTZ
        )
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS "vfs_item_state_updated_idx"
        ON "vfs_item_state" ("updated_at")
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS "vfs_item_state_deleted_idx"
        ON "vfs_item_state" ("deleted_at")
      `);

      await pool.query(`
        ALTER TABLE "vfs_crdt_ops"
        DROP CONSTRAINT IF EXISTS "vfs_crdt_ops_op_type_check"
      `);

      await pool.query(`
        ALTER TABLE "vfs_crdt_ops"
        ADD CONSTRAINT "vfs_crdt_ops_op_type_check"
        CHECK (
          "op_type" IN (
            'acl_add',
            'acl_remove',
            'link_add',
            'link_remove',
            'item_upsert',
            'item_delete'
          )
        )
      `);

      await pool.query('COMMIT');
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  }
};

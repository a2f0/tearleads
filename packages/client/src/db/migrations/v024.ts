import type { Migration } from './types';

/**
 * v024: Add VFS item encryption keys tables
 *
 * Adds local persistence for VFS item encryption keys and shares.
 * - vfs_item_keys: stores session keys per item/epoch
 * - vfs_item_shares: tracks who has access to which key epochs
 */
export const v024: Migration = {
  version: 24,
  description: 'Add VFS item encryption keys tables',
  up: async (adapter) => {
    const statements = [
      `CREATE TABLE IF NOT EXISTS "vfs_item_keys" (
        "item_id" TEXT NOT NULL,
        "key_epoch" INTEGER NOT NULL,
        "session_key_b64" TEXT NOT NULL,
        "created_at" INTEGER NOT NULL,
        PRIMARY KEY ("item_id", "key_epoch")
      )`,
      `CREATE INDEX IF NOT EXISTS "vfs_item_keys_item_id_idx" ON "vfs_item_keys" ("item_id")`,

      `CREATE TABLE IF NOT EXISTS "vfs_item_shares" (
        "item_id" TEXT NOT NULL,
        "recipient_user_id" TEXT NOT NULL,
        "key_epoch" INTEGER NOT NULL,
        "created_at" INTEGER NOT NULL,
        PRIMARY KEY ("item_id", "recipient_user_id", "key_epoch")
      )`,
      `CREATE INDEX IF NOT EXISTS "vfs_item_shares_item_id_idx" ON "vfs_item_shares" ("item_id")`,
      `CREATE INDEX IF NOT EXISTS "vfs_item_shares_recipient_idx" ON "vfs_item_shares" ("recipient_user_id")`
    ];

    await adapter.executeMany(statements);
  }
};

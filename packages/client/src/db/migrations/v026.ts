import type { Migration } from './types';

/**
 * v026: Add canonical VFS item state table
 *
 * Creates the vfs_item_state table used for trash queries (deleted_at)
 * and encrypted item payload snapshots.
 */
export const v026: Migration = {
  version: 26,
  description: 'Add canonical VFS item state table',
  up: async (adapter) => {
    const statements = [
      `CREATE TABLE IF NOT EXISTS "vfs_item_state" (
        "item_id" TEXT PRIMARY KEY REFERENCES "vfs_registry"("id") ON DELETE CASCADE,
        "encrypted_payload" TEXT,
        "key_epoch" INTEGER,
        "encryption_nonce" TEXT,
        "encryption_aad" TEXT,
        "encryption_signature" TEXT,
        "updated_at" INTEGER NOT NULL,
        "deleted_at" INTEGER
      )`,
      `CREATE INDEX IF NOT EXISTS "vfs_item_state_updated_idx" ON "vfs_item_state" ("updated_at")`,
      `CREATE INDEX IF NOT EXISTS "vfs_item_state_deleted_idx" ON "vfs_item_state" ("deleted_at")`
    ];

    await adapter.executeMany(statements);
  }
};

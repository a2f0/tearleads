import type { Migration } from './types';

/**
 * v013: Add vfs_shares table
 *
 * Adds item sharing metadata used by VFS "Shared by me" and "Shared with me".
 */
export const v013: Migration = {
  version: 13,
  description: 'Add vfs_shares table',
  up: async (adapter) => {
    const statements = [
      `CREATE TABLE IF NOT EXISTS "vfs_shares" (
        "id" TEXT PRIMARY KEY NOT NULL,
        "item_id" TEXT NOT NULL REFERENCES "vfs_registry"("id") ON DELETE CASCADE,
        "share_type" TEXT NOT NULL CHECK("share_type" IN ('user', 'group', 'organization')),
        "target_id" TEXT NOT NULL,
        "permission_level" TEXT NOT NULL CHECK("permission_level" IN ('view', 'edit', 'download')),
        "wrapped_session_key" TEXT,
        "created_by" TEXT NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
        "created_at" INTEGER NOT NULL,
        "expires_at" INTEGER
      )`,
      `CREATE INDEX IF NOT EXISTS "vfs_shares_item_idx" ON "vfs_shares" ("item_id")`,
      `CREATE INDEX IF NOT EXISTS "vfs_shares_target_idx" ON "vfs_shares" ("target_id")`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "vfs_shares_item_target_type_idx" ON "vfs_shares" ("item_id", "target_id", "share_type")`,
      `CREATE INDEX IF NOT EXISTS "vfs_shares_expires_idx" ON "vfs_shares" ("expires_at")`
    ];

    await adapter.executeMany(statements);
  }
};

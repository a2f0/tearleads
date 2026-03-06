import type { Migration } from './types';
import { addColumnIfNotExists } from './utils';

/**
 * v025: Add canonical VFS ACL entries table
 *
 * Ensures local databases have the canonical ACL projection table used by
 * shared-with-me and shared-by-me queries in vfs-explorer.
 */
export const v025: Migration = {
  version: 25,
  description: 'Add canonical VFS ACL entries table',
  up: async (adapter) => {
    const statements = [
      `CREATE TABLE IF NOT EXISTS "vfs_acl_entries" (
        "id" TEXT PRIMARY KEY,
        "item_id" TEXT NOT NULL REFERENCES "vfs_registry"("id") ON DELETE CASCADE,
        "principal_type" TEXT NOT NULL,
        "principal_id" TEXT NOT NULL,
        "access_level" TEXT NOT NULL,
        "wrapped_session_key" TEXT,
        "wrapped_hierarchical_key" TEXT,
        "granted_by" TEXT REFERENCES "users"("id") ON DELETE RESTRICT,
        "created_at" INTEGER NOT NULL,
        "updated_at" INTEGER NOT NULL,
        "expires_at" INTEGER,
        "revoked_at" INTEGER
      )`,
      `CREATE INDEX IF NOT EXISTS "vfs_acl_entries_item_idx" ON "vfs_acl_entries" ("item_id")`,
      `CREATE INDEX IF NOT EXISTS "vfs_acl_entries_principal_idx" ON "vfs_acl_entries" ("principal_type", "principal_id")`,
      `CREATE INDEX IF NOT EXISTS "vfs_acl_entries_active_idx" ON "vfs_acl_entries" ("principal_type", "principal_id", "revoked_at", "expires_at")`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "vfs_acl_entries_item_principal_idx" ON "vfs_acl_entries" ("item_id", "principal_type", "principal_id")`
    ];

    await adapter.executeMany(statements);
    await addColumnIfNotExists(
      adapter,
      'vfs_acl_entries',
      'key_epoch',
      'INTEGER'
    );
  }
};

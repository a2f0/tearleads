import type { Migration } from './types';

/**
 * v006: Add VFS tables
 *
 * Creates VFS (Virtual Filesystem) tables for local device-first storage:
 * - vfs_registry: Identity layer for all VFS items
 * - vfs_folders: Folder-specific metadata
 * - vfs_links: Parent/child relationships
 * - vfs_access: Direct access grants for sharing
 */
export const v006: Migration = {
  version: 6,
  description: 'Add VFS tables',
  up: async (adapter) => {
    const statements = [
      // vfs_registry: identity layer for all VFS items
      `CREATE TABLE IF NOT EXISTS "vfs_registry" (
        "id" TEXT PRIMARY KEY NOT NULL,
        "object_type" TEXT NOT NULL,
        "owner_id" TEXT NOT NULL,
        "encrypted_session_key" TEXT,
        "public_hierarchical_key" TEXT,
        "encrypted_private_hierarchical_key" TEXT,
        "created_at" INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS "vfs_registry_owner_idx" ON "vfs_registry" ("owner_id")`,
      `CREATE INDEX IF NOT EXISTS "vfs_registry_type_idx" ON "vfs_registry" ("object_type")`,

      // vfs_folders: folder-specific metadata
      `CREATE TABLE IF NOT EXISTS "vfs_folders" (
        "id" TEXT PRIMARY KEY NOT NULL,
        "encrypted_name" TEXT,
        FOREIGN KEY ("id") REFERENCES "vfs_registry" ("id") ON DELETE CASCADE
      )`,

      // vfs_links: parent/child relationships
      `CREATE TABLE IF NOT EXISTS "vfs_links" (
        "id" TEXT PRIMARY KEY NOT NULL,
        "parent_id" TEXT NOT NULL,
        "child_id" TEXT NOT NULL,
        "wrapped_session_key" TEXT NOT NULL,
        "wrapped_hierarchical_key" TEXT,
        "visible_children" TEXT,
        "created_at" INTEGER NOT NULL,
        FOREIGN KEY ("parent_id") REFERENCES "vfs_registry" ("id") ON DELETE CASCADE,
        FOREIGN KEY ("child_id") REFERENCES "vfs_registry" ("id") ON DELETE CASCADE
      )`,
      `CREATE INDEX IF NOT EXISTS "vfs_links_parent_idx" ON "vfs_links" ("parent_id")`,
      `CREATE INDEX IF NOT EXISTS "vfs_links_child_idx" ON "vfs_links" ("child_id")`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "vfs_links_parent_child_idx" ON "vfs_links" ("parent_id", "child_id")`,

      // vfs_access: direct access grants for sharing
      `CREATE TABLE IF NOT EXISTS "vfs_access" (
        "item_id" TEXT NOT NULL,
        "user_id" TEXT NOT NULL,
        "wrapped_session_key" TEXT NOT NULL,
        "wrapped_hierarchical_key" TEXT,
        "permission_level" TEXT NOT NULL,
        "granted_by" TEXT,
        "granted_at" INTEGER NOT NULL,
        "expires_at" INTEGER,
        PRIMARY KEY ("item_id", "user_id"),
        FOREIGN KEY ("item_id") REFERENCES "vfs_registry" ("id") ON DELETE CASCADE
      )`,
      `CREATE INDEX IF NOT EXISTS "vfs_access_user_idx" ON "vfs_access" ("user_id")`,
      `CREATE INDEX IF NOT EXISTS "vfs_access_item_idx" ON "vfs_access" ("item_id")`
    ];

    await adapter.executeMany(statements);
  }
};

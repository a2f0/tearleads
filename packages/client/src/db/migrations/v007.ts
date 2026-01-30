import type { Migration } from './types';

/**
 * v007: Make vfs_registry.owner_id optional
 *
 * Device-first architecture: Items can be created without a user ID.
 * The ownerId will be populated when the user logs in and syncs.
 *
 * SQLite doesn't support ALTER COLUMN, so we recreate the table.
 */
export const v007: Migration = {
  version: 7,
  description: 'Make vfs_registry.owner_id optional for device-first',
  up: async (adapter) => {
    const statements = [
      // Create new table with owner_id as nullable (no NOT NULL)
      `CREATE TABLE IF NOT EXISTS "vfs_registry_new" (
        "id" TEXT PRIMARY KEY NOT NULL,
        "object_type" TEXT NOT NULL,
        "owner_id" TEXT,
        "encrypted_session_key" TEXT,
        "public_hierarchical_key" TEXT,
        "encrypted_private_hierarchical_key" TEXT,
        "created_at" INTEGER NOT NULL
      )`,

      // Copy existing data
      `INSERT INTO "vfs_registry_new" SELECT * FROM "vfs_registry"`,

      // Drop old table
      `DROP TABLE "vfs_registry"`,

      // Rename new table
      `ALTER TABLE "vfs_registry_new" RENAME TO "vfs_registry"`,

      // Recreate indexes
      `CREATE INDEX IF NOT EXISTS "vfs_registry_owner_idx" ON "vfs_registry" ("owner_id")`,
      `CREATE INDEX IF NOT EXISTS "vfs_registry_type_idx" ON "vfs_registry" ("object_type")`
    ];

    await adapter.executeMany(statements);
  }
};

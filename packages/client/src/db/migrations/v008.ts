import type { Migration } from './types';

/**
 * v008: Add albums table for VFS Option B
 *
 * Creates the albums metadata table that extends vfs_registry
 * for album-type items (photo collections).
 */
export const v008: Migration = {
  version: 8,
  description: 'Add albums table for photo collections',
  up: async (adapter) => {
    const statements = [
      // Create albums table
      `CREATE TABLE IF NOT EXISTS "albums" (
        "id" TEXT PRIMARY KEY NOT NULL REFERENCES "vfs_registry"("id") ON DELETE CASCADE,
        "encrypted_name" TEXT,
        "encrypted_description" TEXT,
        "cover_photo_id" TEXT REFERENCES "vfs_registry"("id") ON DELETE SET NULL
      )`
    ];

    await adapter.executeMany(statements);
  }
};

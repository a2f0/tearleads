import type { Migration } from './types';
import { addColumnIfNotExists, tableExists } from './utils';

/**
 * v010: Add playlists table with media_type column
 *
 * Creates the playlists table for audio/video collections if it doesn't exist.
 * If the table already exists (from server sync), adds the media_type column.
 */
export const v010: Migration = {
  version: 10,
  description: 'Add playlists table for audio/video collections',
  up: async (adapter) => {
    if (!(await tableExists(adapter, 'playlists'))) {
      // Create the full playlists table
      await adapter.execute(`
        CREATE TABLE "playlists" (
          "id" TEXT PRIMARY KEY NOT NULL REFERENCES "vfs_registry"("id") ON DELETE CASCADE,
          "encrypted_name" TEXT,
          "encrypted_description" TEXT,
          "cover_image_id" TEXT REFERENCES "vfs_registry"("id") ON DELETE SET NULL,
          "shuffle_mode" INTEGER NOT NULL DEFAULT 0,
          "media_type" TEXT NOT NULL DEFAULT 'audio'
        )
      `);
      return;
    }

    // Table exists, just add media_type column if missing
    await addColumnIfNotExists(
      adapter,
      'playlists',
      'media_type',
      "TEXT NOT NULL DEFAULT 'audio'"
    );
  }
};

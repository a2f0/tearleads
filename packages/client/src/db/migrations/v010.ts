import type { Migration } from './types';
import { addColumnIfNotExists, tableExists } from './utils';

/**
 * v010: Add playlists table and media_type column
 *
 * Creates the playlists metadata table that extends vfs_registry
 * for playlist-type items. Also adds media_type discriminator column
 * to support both audio and video playlists.
 */
export const v010: Migration = {
  version: 10,
  description: 'Add playlists table with media_type for audio/video support',
  up: async (adapter) => {
    // Check if playlists table exists
    const exists = await tableExists(adapter, 'playlists');

    if (!exists) {
      // Create playlists table with media_type column
      await adapter.execute(`
        CREATE TABLE IF NOT EXISTS "playlists" (
          "id" TEXT PRIMARY KEY NOT NULL REFERENCES "vfs_registry"("id") ON DELETE CASCADE,
          "encrypted_name" TEXT,
          "encrypted_description" TEXT,
          "cover_image_id" TEXT REFERENCES "vfs_registry"("id") ON DELETE SET NULL,
          "shuffle_mode" INTEGER NOT NULL DEFAULT 0,
          "media_type" TEXT NOT NULL DEFAULT 'audio'
        )
      `);
    } else {
      // Table exists, just add the media_type column if missing
      await addColumnIfNotExists(
        adapter,
        'playlists',
        'media_type',
        "TEXT NOT NULL DEFAULT 'audio'"
      );
    }
  }
};

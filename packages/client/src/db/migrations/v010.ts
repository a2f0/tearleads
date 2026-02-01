import type { Migration } from './types';
import { addColumnIfNotExists, tableExists } from './utils';

/**
 * v010: Add media_type column to playlists table
 *
 * Adds a discriminator column to support both audio and video playlists
 * in the same table. Existing playlists default to 'audio'.
 */
export const v010: Migration = {
  version: 10,
  description: 'Add media_type column to playlists for audio/video support',
  up: async (adapter) => {
    // Only add column if the playlists table exists.
    // On fresh databases, the table will be created with this column already.
    if (!(await tableExists(adapter, 'playlists'))) {
      return;
    }

    await addColumnIfNotExists(
      adapter,
      'playlists',
      'media_type',
      "TEXT NOT NULL DEFAULT 'audio'"
    );
  }
};

import type { Pool } from 'pg';
import type { Migration } from './types.js';

/**
 * v013: Add mediaType column to playlists table
 *
 * Adds a media_type discriminator column to support both audio and video playlists.
 * Existing playlists default to 'audio'.
 */
export const v013: Migration = {
  version: 13,
  description: 'Add mediaType column to playlists table',
  up: async (pool: Pool) => {
    await pool.query(`
      ALTER TABLE "playlists"
      ADD COLUMN IF NOT EXISTS "media_type" TEXT NOT NULL DEFAULT 'audio'
    `);
  }
};

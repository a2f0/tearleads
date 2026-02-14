import type { Migration } from './types';

/**
 * v019: Add album_type column to albums table
 *
 * Adds album_type column to support system albums (Photo Roll) vs custom albums.
 */
export const v019: Migration = {
  version: 19,
  description: 'Add album_type column to albums table',
  up: async (adapter) => {
    const statements = [
      `ALTER TABLE "albums" ADD COLUMN "album_type" TEXT NOT NULL DEFAULT 'custom'`
    ];

    await adapter.executeMany(statements);
  }
};

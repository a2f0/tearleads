import type { Pool } from 'pg';
import type { Migration } from './types.js';

/**
 * v027: Add encrypted_name column to vfs_registry
 *
 * The smtp-listener's ensureInboxFolder writes encrypted_name directly to
 * vfs_registry. The client-side SQLite schema already has this column (added
 * in client migration v023), but the server Postgres schema was missing it.
 */
export const v027: Migration = {
  version: 27,
  description: 'Add encrypted_name column to vfs_registry',
  up: async (pool: Pool) => {
    await pool.query(`
      ALTER TABLE "vfs_registry"
      ADD COLUMN IF NOT EXISTS "encrypted_name" TEXT
    `);
  }
};

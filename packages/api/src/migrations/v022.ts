import type { Pool } from 'pg';
import type { Migration } from './types.js';

/**
 * v022: Add key_epoch column to vfs_acl_entries for tracking wrapped key epochs.
 *
 * This column tracks which key epoch the wrapped_session_key belongs to,
 * allowing clients to detect stale keys after rekey operations.
 */
export const v022: Migration = {
  version: 22,
  description:
    'Add key_epoch column to vfs_acl_entries for key rotation tracking',
  up: async (pool: Pool) => {
    await pool.query('BEGIN');
    try {
      await pool.query(`
        ALTER TABLE "vfs_acl_entries"
        ADD COLUMN IF NOT EXISTS "key_epoch" INTEGER
      `);

      await pool.query('COMMIT');
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  }
};

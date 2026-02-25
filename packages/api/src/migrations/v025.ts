import type { Pool } from 'pg';
import type { Migration } from './types.js';

/**
 * Migration v025: Add feed-order index for CRDT pull pagination queries.
 */
export const v025: Migration = {
  version: 25,
  description: 'Add CRDT feed ordering index',
  up: async (pool: Pool) => {
    await pool.query('BEGIN');
    try {
      await pool.query(`
        CREATE INDEX IF NOT EXISTS "vfs_crdt_ops_occurred_id_idx"
        ON "vfs_crdt_ops" ("occurred_at", "id")
      `);

      await pool.query('COMMIT');
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  }
};

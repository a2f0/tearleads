import type { Pool } from 'pg';
import type { Migration } from './types.js';

/**
 * v021: Add per-client sync reconciliation state table
 *
 * Creates:
 * - vfs_sync_client_state: last reconciled cursor per user/client pair
 */
export const v021: Migration = {
  version: 21,
  description: 'Add per-client VFS sync reconciliation cursor state',
  up: async (pool: Pool) => {
    await pool.query('BEGIN');
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS "vfs_sync_client_state" (
          "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
          "client_id" TEXT NOT NULL,
          "last_reconciled_at" TIMESTAMPTZ NOT NULL,
          "last_reconciled_change_id" TEXT NOT NULL,
          "updated_at" TIMESTAMPTZ NOT NULL,
          PRIMARY KEY ("user_id", "client_id")
        )
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS "vfs_sync_client_state_user_idx"
        ON "vfs_sync_client_state" ("user_id")
      `);

      await pool.query('COMMIT');
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  }
};

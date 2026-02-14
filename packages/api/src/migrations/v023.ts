import type { Pool } from 'pg';
import type { Migration } from './types.js';

/**
 * v023: Persist CRDT per-replica write-id watermarks in client state
 *
 * Adds:
 * - vfs_sync_client_state.last_reconciled_write_ids jsonb
 * - vfs_merge_reconciled_write_ids(base, incoming) helper for monotonic merge
 */
export const v023: Migration = {
  version: 23,
  description: 'Persist CRDT last reconciled write-id watermarks',
  up: async (pool: Pool) => {
    await pool.query('BEGIN');
    try {
      await pool.query(`
        ALTER TABLE "vfs_sync_client_state"
        ADD COLUMN IF NOT EXISTS "last_reconciled_write_ids" JSONB NOT NULL DEFAULT '{}'::jsonb
      `);

      await pool.query(`
        CREATE OR REPLACE FUNCTION "vfs_merge_reconciled_write_ids"(
          base JSONB,
          incoming JSONB
        )
        RETURNS JSONB
        LANGUAGE SQL
        IMMUTABLE
        AS $$
          SELECT COALESCE(
            (
              SELECT jsonb_object_agg(
                keys.key,
                GREATEST(
                  CASE
                    WHEN ((COALESCE(base, '{}'::jsonb) ->> keys.key) ~ '^[0-9]+$')
                      THEN (COALESCE(base, '{}'::jsonb) ->> keys.key)::BIGINT
                    ELSE 0
                  END,
                  CASE
                    WHEN ((COALESCE(incoming, '{}'::jsonb) ->> keys.key) ~ '^[0-9]+$')
                      THEN (COALESCE(incoming, '{}'::jsonb) ->> keys.key)::BIGINT
                    ELSE 0
                  END
                )
              )
              FROM (
                SELECT key FROM jsonb_object_keys(COALESCE(base, '{}'::jsonb))
                UNION
                SELECT key FROM jsonb_object_keys(COALESCE(incoming, '{}'::jsonb))
              ) AS keys
            ),
            '{}'::jsonb
          )
        $$;
      `);

      await pool.query('COMMIT');
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  }
};

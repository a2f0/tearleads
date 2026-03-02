import type { Pool } from 'pg';
import type { Migration } from './types.js';

/**
 * v030: Add expression index for MLS message sequence lookups in vfs_crdt_ops.
 *
 * MLS message writes need the latest per-group sequence number while holding a
 * transaction lock. This index supports that lookup without scanning all
 * matching CRDT rows.
 */
export const v030: Migration = {
  version: 30,
  description: 'Add index for MLS sequence lookup in vfs_crdt_ops',
  up: async (pool: Pool) => {
    await pool.query(`
      CREATE INDEX IF NOT EXISTS "vfs_crdt_ops_mls_group_seq_idx"
      ON "vfs_crdt_ops" (
        (split_part("source_id", ':', 2)),
        (
          CASE
            WHEN split_part("source_id", ':', 3) ~ '^[0-9]+$'
            THEN split_part("source_id", ':', 3)::integer
            ELSE NULL
          END
        ) DESC
      )
      WHERE "op_type" = 'item_upsert'
        AND "source_table" IN ('mls_messages', 'mls_message')
        AND split_part("source_id", ':', 1) = 'mls_message'
    `);
  }
};

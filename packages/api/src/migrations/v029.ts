import type { Pool } from 'pg';
import type { Migration } from './types.js';

/**
 * v029: Add CRDT snapshot storage for stale-client rematerialization.
 *
 * Stores periodically refreshed CRDT replay snapshots so stale clients can
 * recover from compaction without replaying the full retained CRDT log.
 */
export const v029: Migration = {
  version: 29,
  description: 'Add CRDT snapshot storage for stale-client rematerialization',
  up: async (pool: Pool) => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "vfs_crdt_snapshots" (
        "scope" TEXT PRIMARY KEY,
        "snapshot_version" INTEGER NOT NULL DEFAULT 1,
        "snapshot_payload" JSONB NOT NULL,
        "snapshot_cursor_changed_at" TIMESTAMPTZ,
        "snapshot_cursor_change_id" TEXT,
        "created_at" TIMESTAMPTZ NOT NULL,
        "updated_at" TIMESTAMPTZ NOT NULL,
        CONSTRAINT "vfs_crdt_snapshots_cursor_pair_check"
          CHECK (
            (
              "snapshot_cursor_changed_at" IS NULL
              AND "snapshot_cursor_change_id" IS NULL
            )
            OR (
              "snapshot_cursor_changed_at" IS NOT NULL
              AND "snapshot_cursor_change_id" IS NOT NULL
            )
          )
      )
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS "vfs_crdt_snapshots_updated_idx"
      ON "vfs_crdt_snapshots" ("updated_at")
    `);
  }
};

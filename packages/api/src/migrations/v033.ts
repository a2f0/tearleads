import type { Pool } from 'pg';
import type { Migration } from './types.js';

/**
 * v033: Add per-actor replica write-head denormalization table.
 *
 * Stores the latest client replica write id and occurred_at per actor+replica
 * so pull/session/rematerialization paths can avoid scan-heavy parsing over
 * vfs_crdt_ops.
 */
export const v033: Migration = {
  version: 33,
  description: 'Add CRDT replica write heads table',
  up: async (pool: Pool) => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "vfs_crdt_replica_heads" (
        "actor_id" TEXT NOT NULL,
        "replica_id" TEXT NOT NULL,
        "max_write_id" BIGINT NOT NULL,
        "max_occurred_at" TIMESTAMPTZ NOT NULL,
        "updated_at" TIMESTAMPTZ NOT NULL,
        PRIMARY KEY ("actor_id", "replica_id"),
        CONSTRAINT "vfs_crdt_replica_heads_max_write_positive_check"
          CHECK ("max_write_id" > 0)
      )
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS "vfs_crdt_replica_heads_updated_idx"
      ON "vfs_crdt_replica_heads" ("updated_at")
    `);

    await pool.query(`
      INSERT INTO vfs_crdt_replica_heads (
        actor_id,
        replica_id,
        max_write_id,
        max_occurred_at,
        updated_at
      )
      SELECT
        ops.actor_id,
        btrim(split_part(ops.source_id, ':', 2)) AS replica_id,
        MAX(
          CASE
            WHEN split_part(ops.source_id, ':', 3) ~ '^[0-9]+$'
              THEN split_part(ops.source_id, ':', 3)::bigint
            ELSE NULL
          END
        ) AS max_write_id,
        MAX(ops.occurred_at) AS max_occurred_at,
        NOW() AS updated_at
      FROM vfs_crdt_ops ops
      WHERE ops.source_table = 'vfs_crdt_client_push'
      GROUP BY ops.actor_id, btrim(split_part(ops.source_id, ':', 2))
      HAVING btrim(split_part(ops.source_id, ':', 2)) <> ''
        AND MAX(
          CASE
            WHEN split_part(ops.source_id, ':', 3) ~ '^[0-9]+$'
              THEN split_part(ops.source_id, ':', 3)::bigint
            ELSE NULL
          END
        ) IS NOT NULL
      ON CONFLICT (actor_id, replica_id) DO UPDATE SET
        max_write_id = GREATEST(
          vfs_crdt_replica_heads.max_write_id,
          EXCLUDED.max_write_id
        ),
        max_occurred_at = GREATEST(
          vfs_crdt_replica_heads.max_occurred_at,
          EXCLUDED.max_occurred_at
        ),
        updated_at = NOW()
    `);
  }
};

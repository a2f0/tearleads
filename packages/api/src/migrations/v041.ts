import type { Pool } from 'pg';
import type { Migration } from './types.js';

/**
 * v041: Stage share drop-execution candidates.
 *
 * Non-destructive migration that records whether each planned share-table drop
 * step is currently executable. Future destructive migrations must require
 * `is_executable = TRUE` for the target step before issuing `DROP TABLE`.
 */
export const v041: Migration = {
  version: 41,
  description: 'Record share drop execution candidates',
  up: async (pool: Pool) => {
    await pool.query('BEGIN');
    try {
      await pool.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1
            FROM "schema_migrations"
            WHERE "version" = 40
          ) THEN
            RAISE EXCEPTION
              'v041 abort: v040 must be recorded before share drop execution candidates';
          END IF;

          IF to_regclass('public.vfs_share_retirement_drop_authorizations') IS NULL THEN
            RAISE EXCEPTION
              'v041 abort: share drop authorization checkpoints missing before execution candidates';
          END IF;

          IF NOT EXISTS (
            SELECT 1
            FROM "vfs_share_retirement_drop_authorizations"
            WHERE "candidate_table" = 'vfs_shares'
              AND "planned_step" = 'step-1'
          ) THEN
            RAISE EXCEPTION
              'v041 abort: vfs_shares step-1 authorization checkpoint missing before execution candidates';
          END IF;

          IF NOT EXISTS (
            SELECT 1
            FROM "vfs_share_retirement_drop_authorizations"
            WHERE "candidate_table" = 'org_shares'
              AND "planned_step" = 'step-2'
          ) THEN
            RAISE EXCEPTION
              'v041 abort: org_shares step-2 authorization checkpoint missing before execution candidates';
          END IF;
        END;
        $$;
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS "vfs_share_retirement_drop_execution_candidates" (
          "id" BIGSERIAL PRIMARY KEY,
          "captured_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          "candidate_table" TEXT NOT NULL,
          "planned_step" TEXT NOT NULL,
          "drop_statement" TEXT NOT NULL,
          "authorization_checkpoint_id" BIGINT NOT NULL,
          "is_executable" BOOLEAN NOT NULL,
          "blocking_reason" TEXT NOT NULL
        )
      `);

      await pool.query(`
        WITH latest_authorizations AS (
          SELECT DISTINCT ON ("candidate_table")
            "id",
            "candidate_table",
            "planned_step",
            "is_drop_authorized"
          FROM "vfs_share_retirement_drop_authorizations"
          WHERE "candidate_table" IN ('vfs_shares', 'org_shares')
          ORDER BY "candidate_table", "captured_at" DESC, "id" DESC
        )
        INSERT INTO "vfs_share_retirement_drop_execution_candidates" (
          "candidate_table",
          "planned_step",
          "drop_statement",
          "authorization_checkpoint_id",
          "is_executable",
          "blocking_reason"
        )
        SELECT
          auth."candidate_table",
          auth."planned_step",
          CASE
            WHEN auth."candidate_table" = 'vfs_shares' THEN 'DROP TABLE "vfs_shares";'
            ELSE 'DROP TABLE "org_shares";'
          END,
          auth."id",
          CASE
            WHEN auth."candidate_table" = 'vfs_shares'
              THEN auth."is_drop_authorized"
            ELSE FALSE
          END,
          CASE
            WHEN auth."candidate_table" = 'vfs_shares'
              AND auth."is_drop_authorized" = TRUE
              THEN 'executable'
            WHEN auth."candidate_table" = 'vfs_shares'
              THEN 'Latest vfs_shares authorization is not executable; confirm read-surface deactivation before destructive migration.'
            ELSE 'org_shares drop is deferred until vfs_shares retirement completes.'
          END
        FROM latest_authorizations auth
      `);

      await pool.query('COMMIT');
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  }
};

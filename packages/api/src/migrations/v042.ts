import type { Pool } from 'pg';
import type { Migration } from './types.js';

/**
 * v042: Execute first destructive share-retirement step (vfs_shares).
 *
 * This migration is intentionally fail-closed. It requires the latest step-1
 * execution candidate to be explicitly executable before dropping `vfs_shares`.
 * The drop action is recorded in an execution-audit table for sequencing and
 * rollback analysis.
 */
export const v042: Migration = {
  version: 42,
  description: 'Drop vfs_shares using executable guardrails',
  up: async (pool: Pool) => {
    await pool.query('BEGIN');
    try {
      await pool.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1
            FROM "schema_migrations"
            WHERE "version" = 41
          ) THEN
            RAISE EXCEPTION
              'v042 abort: v041 must be recorded before vfs_shares drop';
          END IF;

          IF to_regclass('public.vfs_shares') IS NULL THEN
            RAISE EXCEPTION
              'v042 abort: vfs_shares missing before step-1 drop';
          END IF;

          IF to_regclass('public.vfs_acl_entries') IS NULL THEN
            RAISE EXCEPTION
              'v042 abort: vfs_acl_entries missing before vfs_shares drop';
          END IF;

          IF to_regclass('public.vfs_share_retirement_drop_execution_candidates') IS NULL THEN
            RAISE EXCEPTION
              'v042 abort: share drop execution candidates missing before vfs_shares drop';
          END IF;

          IF COALESCE(
            (
              SELECT "is_executable"
              FROM "vfs_share_retirement_drop_execution_candidates"
              WHERE "candidate_table" = 'vfs_shares'
                AND "planned_step" = 'step-1'
              ORDER BY "captured_at" DESC, "id" DESC
              LIMIT 1
            ),
            FALSE
          ) IS DISTINCT FROM TRUE THEN
            RAISE EXCEPTION
              'v042 abort: latest vfs_shares step-1 execution candidate is not executable';
          END IF;
        END;
        $$;
      `);

      await pool.query(`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1
            FROM "vfs_shares" s
            LEFT JOIN "vfs_acl_entries" acl
              ON acl.item_id = s.item_id
             AND acl.principal_type = s.share_type
             AND acl.principal_id = s.target_id
             AND acl.revoked_at IS NULL
             AND acl.access_level = CASE s.permission_level
               WHEN 'edit' THEN 'write'
               ELSE 'read'
             END
             AND acl.granted_by IS NOT DISTINCT FROM s.created_by
             AND acl.expires_at IS NOT DISTINCT FROM s.expires_at
            WHERE acl.id IS NULL
          ) THEN
            RAISE EXCEPTION
              'v042 abort: vfs_shares rows missing canonical active ACL parity at drop time';
          END IF;
        END;
        $$;
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS "vfs_share_retirement_drop_execution_audit" (
          "id" BIGSERIAL PRIMARY KEY,
          "captured_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          "candidate_table" TEXT NOT NULL,
          "planned_step" TEXT NOT NULL,
          "drop_statement" TEXT NOT NULL,
          "is_executed" BOOLEAN NOT NULL,
          "result" TEXT NOT NULL,
          "details" TEXT
        )
      `);

      await pool.query('DROP TABLE "vfs_shares"');

      await pool.query(`
        INSERT INTO "vfs_share_retirement_drop_execution_audit" (
          "candidate_table",
          "planned_step",
          "drop_statement",
          "is_executed",
          "result",
          "details"
        )
        VALUES (
          'vfs_shares',
          'step-1',
          'DROP TABLE "vfs_shares";',
          TRUE,
          'dropped',
          NULL
        )
      `);

      await pool.query('COMMIT');
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  }
};

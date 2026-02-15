import type { Pool } from 'pg';
import type { Migration } from './types.js';

/**
 * v044: Finalize share-table retirement scaffolding.
 *
 * Drops transitional share-retirement scaffolding after both destructive
 * retirement steps have been durably audited. Keeps the execution-audit table
 * for historical traceability.
 */
export const v044: Migration = {
  version: 44,
  description: 'Finalize share retirement scaffolding',
  up: async (pool: Pool) => {
    await pool.query('BEGIN');
    try {
      await pool.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1
            FROM "schema_migrations"
            WHERE "version" = 43
          ) THEN
            RAISE EXCEPTION
              'v044 abort: v043 must be recorded before share retirement finalization';
          END IF;

          IF to_regclass('public.vfs_shares') IS NOT NULL THEN
            RAISE EXCEPTION
              'v044 abort: vfs_shares still exists before share retirement finalization';
          END IF;

          IF to_regclass('public.org_shares') IS NOT NULL THEN
            RAISE EXCEPTION
              'v044 abort: org_shares still exists before share retirement finalization';
          END IF;

          IF to_regclass('public.vfs_share_retirement_drop_execution_audit') IS NULL THEN
            RAISE EXCEPTION
              'v044 abort: share drop execution audit missing before finalization';
          END IF;

          IF NOT EXISTS (
            SELECT 1
            FROM "vfs_share_retirement_drop_execution_audit"
            WHERE "candidate_table" = 'vfs_shares'
              AND "planned_step" = 'step-1'
              AND "is_executed" = TRUE
              AND "result" = 'dropped'
          ) THEN
            RAISE EXCEPTION
              'v044 abort: step-1 drop audit missing before share retirement finalization';
          END IF;

          IF NOT EXISTS (
            SELECT 1
            FROM "vfs_share_retirement_drop_execution_audit"
            WHERE "candidate_table" = 'org_shares'
              AND "planned_step" = 'step-2'
              AND "is_executed" = TRUE
              AND "result" = 'dropped'
          ) THEN
            RAISE EXCEPTION
              'v044 abort: step-2 drop audit missing before share retirement finalization';
          END IF;
        END;
        $$;
      `);

      await pool.query(
        'DROP TABLE IF EXISTS "vfs_share_retirement_checkpoints"'
      );
      await pool.query(
        'DROP TABLE IF EXISTS "vfs_share_retirement_drop_plans"'
      );
      await pool.query(
        'DROP TABLE IF EXISTS "vfs_share_retirement_drop_candidates"'
      );
      await pool.query(
        'DROP TABLE IF EXISTS "vfs_share_retirement_execution_readiness"'
      );
      await pool.query(
        'DROP TABLE IF EXISTS "vfs_share_retirement_drop_authorizations"'
      );
      await pool.query(
        'DROP TABLE IF EXISTS "vfs_share_retirement_drop_execution_candidates"'
      );

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
          'share_retirement',
          'finalize',
          'DROP RETIREMENT SCAFFOLDING TABLES',
          TRUE,
          'scaffolding_retired',
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

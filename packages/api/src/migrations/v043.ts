import type { Pool } from 'pg';
import type { Migration } from './types.js';

/**
 * v043: Execute second destructive share-retirement step (org_shares).
 *
 * Fail-closed sequencing:
 * 1) step-1 (`vfs_shares`) must be durably audited as dropped
 * 2) latest step-2 authorization must be executable
 * 3) step-2 execution candidate is refreshed and validated as executable
 */
export const v043: Migration = {
  version: 43,
  description: 'Drop org_shares using sequenced guardrails',
  up: async (pool: Pool) => {
    await pool.query('BEGIN');
    try {
      await pool.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1
            FROM "schema_migrations"
            WHERE "version" = 42
          ) THEN
            RAISE EXCEPTION
              'v043 abort: v042 must be recorded before org_shares drop';
          END IF;

          IF to_regclass('public.org_shares') IS NULL THEN
            RAISE EXCEPTION
              'v043 abort: org_shares missing before step-2 drop';
          END IF;

          IF to_regclass('public.vfs_acl_entries') IS NULL THEN
            RAISE EXCEPTION
              'v043 abort: vfs_acl_entries missing before org_shares drop';
          END IF;

          IF to_regclass('public.vfs_share_retirement_drop_execution_audit') IS NULL THEN
            RAISE EXCEPTION
              'v043 abort: share drop execution audit missing before org_shares drop';
          END IF;

          IF to_regclass('public.vfs_share_retirement_drop_execution_candidates') IS NULL THEN
            RAISE EXCEPTION
              'v043 abort: share drop execution candidates missing before org_shares drop';
          END IF;

          IF to_regclass('public.vfs_share_retirement_drop_authorizations') IS NULL THEN
            RAISE EXCEPTION
              'v043 abort: share drop authorizations missing before org_shares drop';
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
              'v043 abort: vfs_shares step-1 drop audit success missing before org_shares drop';
          END IF;

          IF COALESCE(
            (
              SELECT "is_drop_authorized"
              FROM "vfs_share_retirement_drop_authorizations"
              WHERE "candidate_table" = 'org_shares'
                AND "planned_step" = 'step-2'
              ORDER BY "captured_at" DESC, "id" DESC
              LIMIT 1
            ),
            FALSE
          ) IS DISTINCT FROM TRUE THEN
            RAISE EXCEPTION
              'v043 abort: latest org_shares step-2 authorization is not executable';
          END IF;
        END;
        $$;
      `);

      await pool.query(`
        INSERT INTO "vfs_share_retirement_drop_execution_candidates" (
          "candidate_table",
          "planned_step",
          "drop_statement",
          "authorization_checkpoint_id",
          "is_executable",
          "blocking_reason"
        )
        SELECT
          'org_shares',
          'step-2',
          'DROP TABLE "org_shares";',
          auth."id",
          TRUE,
          'executable'
        FROM (
          SELECT "id"
          FROM "vfs_share_retirement_drop_authorizations"
          WHERE "candidate_table" = 'org_shares'
            AND "planned_step" = 'step-2'
            AND "is_drop_authorized" = TRUE
          ORDER BY "captured_at" DESC, "id" DESC
          LIMIT 1
        ) auth
      `);

      await pool.query(`
        DO $$
        BEGIN
          IF COALESCE(
            (
              SELECT "is_executable"
              FROM "vfs_share_retirement_drop_execution_candidates"
              WHERE "candidate_table" = 'org_shares'
                AND "planned_step" = 'step-2'
              ORDER BY "captured_at" DESC, "id" DESC
              LIMIT 1
            ),
            FALSE
          ) IS DISTINCT FROM TRUE THEN
            RAISE EXCEPTION
              'v043 abort: latest org_shares step-2 execution candidate is not executable';
          END IF;

          IF EXISTS (
            SELECT 1
            FROM "org_shares" os
            LEFT JOIN "vfs_acl_entries" acl
              ON acl.item_id = os.item_id
             AND acl.principal_type = 'organization'
             AND acl.principal_id = os.target_org_id
             AND acl.revoked_at IS NULL
             AND acl.access_level = CASE os.permission_level
               WHEN 'edit' THEN 'write'
               ELSE 'read'
             END
             AND acl.granted_by IS NOT DISTINCT FROM os.created_by
             AND acl.expires_at IS NOT DISTINCT FROM os.expires_at
            WHERE acl.id IS NULL
          ) THEN
            RAISE EXCEPTION
              'v043 abort: org_shares rows missing canonical active ACL parity at drop time';
          END IF;
        END;
        $$;
      `);

      await pool.query('DROP TABLE "org_shares"');

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
          'org_shares',
          'step-2',
          'DROP TABLE "org_shares";',
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

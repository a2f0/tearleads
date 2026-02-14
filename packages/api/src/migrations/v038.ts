import type { Pool } from 'pg';
import type { Migration } from './types.js';

/**
 * v038: Stage share drop-candidate dry-run guardrails.
 *
 * Non-destructive scaffolding migration that captures an explicit dry-run
 * candidate snapshot for legacy share-table retirement. This migration must not
 * drop tables; it only records auditable readiness metadata once v037 planning
 * checkpoints and canonical ACL parity/source-trace guardrails are still true.
 */
export const v038: Migration = {
  version: 38,
  description: 'Record share drop-candidate dry-run checkpoint',
  up: async (pool: Pool) => {
    await pool.query('BEGIN');
    try {
      await pool.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1
            FROM "schema_migrations"
            WHERE "version" = 37
          ) THEN
            RAISE EXCEPTION
              'v038 abort: v037 must be recorded before share drop-candidate dry-run';
          END IF;

          IF to_regclass('public.vfs_acl_entries') IS NULL THEN
            RAISE EXCEPTION
              'v038 abort: vfs_acl_entries missing before share drop-candidate dry-run';
          END IF;

          IF to_regclass('public.vfs_shares') IS NULL THEN
            RAISE EXCEPTION
              'v038 abort: vfs_shares missing before share drop-candidate dry-run';
          END IF;

          IF to_regclass('public.org_shares') IS NULL THEN
            RAISE EXCEPTION
              'v038 abort: org_shares missing before share drop-candidate dry-run';
          END IF;

          IF to_regclass('public.vfs_share_retirement_checkpoints') IS NULL THEN
            RAISE EXCEPTION
              'v038 abort: share retirement checkpoints missing before share drop-candidate dry-run';
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM "vfs_share_retirement_checkpoints"
          ) THEN
            RAISE EXCEPTION
              'v038 abort: no share retirement checkpoint rows recorded before share drop-candidate dry-run';
          END IF;

          IF to_regclass('public.vfs_share_retirement_drop_plans') IS NULL THEN
            RAISE EXCEPTION
              'v038 abort: share drop-planning checkpoints missing before share drop-candidate dry-run';
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM "vfs_share_retirement_drop_plans"
          ) THEN
            RAISE EXCEPTION
              'v038 abort: no share drop-planning rows recorded before share drop-candidate dry-run';
          END IF;

          IF NOT EXISTS (
            SELECT 1
            FROM "vfs_share_retirement_drop_plans"
            WHERE "planned_drop_order" = 'vfs_shares_then_org_shares'
          ) THEN
            RAISE EXCEPTION
              'v038 abort: expected share drop order checkpoint missing before dry-run';
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
              'v038 abort: vfs_shares rows missing canonical active ACL parity';
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
              'v038 abort: org_shares rows missing canonical active ACL parity';
          END IF;

          IF EXISTS (
            SELECT 1
            FROM "vfs_acl_entries" acl
            LEFT JOIN "vfs_shares" s
              ON s.id = SUBSTRING(acl.id FROM 7)
            WHERE acl.id LIKE 'share:%'
              AND s.id IS NULL
          ) THEN
            RAISE EXCEPTION
              'v038 abort: share-sourced ACL rows orphaned from vfs_shares';
          END IF;

          IF EXISTS (
            SELECT 1
            FROM "vfs_acl_entries" acl
            LEFT JOIN "org_shares" os
              ON os.id = SUBSTRING(acl.id FROM 11)
            WHERE acl.id LIKE 'org-share:%'
              AND os.id IS NULL
          ) THEN
            RAISE EXCEPTION
              'v038 abort: org-share-sourced ACL rows orphaned from org_shares';
          END IF;
        END;
        $$;
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS "vfs_share_retirement_drop_candidates" (
          "id" BIGSERIAL PRIMARY KEY,
          "captured_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          "candidate_table" TEXT NOT NULL,
          "planned_step" TEXT NOT NULL,
          "dry_run_statement" TEXT NOT NULL,
          "legacy_row_count" BIGINT NOT NULL,
          "canonical_active_acl_count" BIGINT NOT NULL,
          "is_ready" BOOLEAN NOT NULL,
          "blocking_reason" TEXT
        )
      `);

      await pool.query(`
        INSERT INTO "vfs_share_retirement_drop_candidates" (
          "candidate_table",
          "planned_step",
          "dry_run_statement",
          "legacy_row_count",
          "canonical_active_acl_count",
          "is_ready",
          "blocking_reason"
        )
        VALUES
          (
            'vfs_shares',
            'step-1',
            'DROP TABLE "vfs_shares";',
            (SELECT COUNT(*) FROM "vfs_shares"),
            (
              SELECT COUNT(*)
              FROM "vfs_acl_entries"
              WHERE "revoked_at" IS NULL
                AND "id" LIKE 'share:%'
            ),
            TRUE,
            NULL
          ),
          (
            'org_shares',
            'step-2',
            'DROP TABLE "org_shares";',
            (SELECT COUNT(*) FROM "org_shares"),
            (
              SELECT COUNT(*)
              FROM "vfs_acl_entries"
              WHERE "revoked_at" IS NULL
                AND "id" LIKE 'org-share:%'
            ),
            TRUE,
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

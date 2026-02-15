import type { Pool } from 'pg';
import type { Migration } from './types.js';

/**
 * v040: Stage share-drop execution authorization guardrails.
 *
 * Non-destructive scaffolding migration. It never drops legacy share tables;
 * it records an auditable authorization checkpoint that future destructive
 * migrations must require before attempting table retirement.
 */
export const v040: Migration = {
  version: 40,
  description: 'Record share drop authorization guardrails',
  up: async (pool: Pool) => {
    await pool.query('BEGIN');
    try {
      await pool.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1
            FROM "schema_migrations"
            WHERE "version" = 39
          ) THEN
            RAISE EXCEPTION
              'v040 abort: v039 must be recorded before share drop authorization guardrails';
          END IF;

          IF to_regclass('public.vfs_acl_entries') IS NULL THEN
            RAISE EXCEPTION
              'v040 abort: vfs_acl_entries missing before share drop authorization guardrails';
          END IF;

          IF to_regclass('public.vfs_shares') IS NULL THEN
            RAISE EXCEPTION
              'v040 abort: vfs_shares missing before share drop authorization guardrails';
          END IF;

          IF to_regclass('public.org_shares') IS NULL THEN
            RAISE EXCEPTION
              'v040 abort: org_shares missing before share drop authorization guardrails';
          END IF;

          IF to_regclass('public.vfs_share_retirement_drop_candidates') IS NULL THEN
            RAISE EXCEPTION
              'v040 abort: share drop-candidate checkpoints missing before drop authorization guardrails';
          END IF;

          IF NOT EXISTS (
            SELECT 1
            FROM "vfs_share_retirement_drop_candidates"
            WHERE "candidate_table" = 'vfs_shares'
              AND "is_ready" = TRUE
          ) THEN
            RAISE EXCEPTION
              'v040 abort: vfs_shares drop-candidate readiness checkpoint missing before drop authorization guardrails';
          END IF;

          IF NOT EXISTS (
            SELECT 1
            FROM "vfs_share_retirement_drop_candidates"
            WHERE "candidate_table" = 'org_shares'
              AND "is_ready" = TRUE
          ) THEN
            RAISE EXCEPTION
              'v040 abort: org_shares drop-candidate readiness checkpoint missing before drop authorization guardrails';
          END IF;

          IF to_regclass('public.vfs_share_retirement_execution_readiness') IS NULL THEN
            RAISE EXCEPTION
              'v040 abort: share execution-readiness checkpoints missing before drop authorization guardrails';
          END IF;

          IF NOT EXISTS (
            SELECT 1
            FROM "vfs_share_retirement_execution_readiness"
            WHERE "required_marker" = 'legacy_share_read_surfaces_deactivated'
          ) THEN
            RAISE EXCEPTION
              'v040 abort: required execution-readiness marker missing before drop authorization guardrails';
          END IF;

          IF NOT EXISTS (
            SELECT 1
            FROM "vfs_share_retirement_execution_readiness"
            WHERE "required_marker" = 'legacy_share_read_surfaces_deactivated'
              AND "canonical_read_contract" = 'acl-first-share-read-path-with-transition-parity'
          ) THEN
            RAISE EXCEPTION
              'v040 abort: canonical read contract mismatch before drop authorization guardrails';
          END IF;

          IF NOT EXISTS (
            SELECT 1
            FROM "vfs_share_retirement_execution_readiness"
            WHERE "required_marker" = 'legacy_share_read_surfaces_deactivated'
              AND "legacy_read_surface_inventory" = 'GET /v1/vfs/items/:itemId/shares; loadShareAuthorizationContext; loadOrgShareAuthorizationContext'
          ) THEN
            RAISE EXCEPTION
              'v040 abort: legacy read-surface inventory mismatch before drop authorization guardrails';
          END IF;

          IF COALESCE(
            (
              SELECT "canonical_read_contract"
              FROM "vfs_share_retirement_execution_readiness"
              WHERE "required_marker" = 'legacy_share_read_surfaces_deactivated'
              ORDER BY "captured_at" DESC, "id" DESC
              LIMIT 1
            ),
            ''
          ) <> 'acl-first-share-read-path-with-transition-parity' THEN
            RAISE EXCEPTION
              'v040 abort: latest execution-readiness marker must match canonical read contract before drop authorization guardrails';
          END IF;

          IF COALESCE(
            (
              SELECT "legacy_read_surface_inventory"
              FROM "vfs_share_retirement_execution_readiness"
              WHERE "required_marker" = 'legacy_share_read_surfaces_deactivated'
              ORDER BY "captured_at" DESC, "id" DESC
              LIMIT 1
            ),
            ''
          ) <> 'GET /v1/vfs/items/:itemId/shares; loadShareAuthorizationContext; loadOrgShareAuthorizationContext' THEN
            RAISE EXCEPTION
              'v040 abort: latest execution-readiness marker must match legacy read-surface inventory before drop authorization guardrails';
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
              'v040 abort: vfs_shares rows missing canonical active ACL parity';
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
              'v040 abort: org_shares rows missing canonical active ACL parity';
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
              'v040 abort: share-sourced ACL rows orphaned from vfs_shares';
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
              'v040 abort: org-share-sourced ACL rows orphaned from org_shares';
          END IF;
        END;
        $$;
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS "vfs_share_retirement_drop_authorizations" (
          "id" BIGSERIAL PRIMARY KEY,
          "captured_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          "candidate_table" TEXT NOT NULL,
          "planned_step" TEXT NOT NULL,
          "required_marker" TEXT NOT NULL,
          "read_surface_deactivation_confirmed" BOOLEAN NOT NULL,
          "execution_readiness_is_ready" BOOLEAN NOT NULL,
          "parity_revalidated" BOOLEAN NOT NULL,
          "is_drop_authorized" BOOLEAN NOT NULL,
          "blocking_reason" TEXT NOT NULL
        )
      `);

      await pool.query(`
        WITH latest_execution_readiness AS (
          SELECT
            "required_marker",
            "read_surface_deactivation_confirmed",
            "is_ready"
          FROM "vfs_share_retirement_execution_readiness"
          WHERE "required_marker" = 'legacy_share_read_surfaces_deactivated'
          ORDER BY "captured_at" DESC, "id" DESC
          LIMIT 1
        )
        INSERT INTO "vfs_share_retirement_drop_authorizations" (
          "candidate_table",
          "planned_step",
          "required_marker",
          "read_surface_deactivation_confirmed",
          "execution_readiness_is_ready",
          "parity_revalidated",
          "is_drop_authorized",
          "blocking_reason"
        )
        SELECT
          candidates."candidate_table",
          candidates."planned_step",
          readiness."required_marker",
          readiness."read_surface_deactivation_confirmed",
          readiness."is_ready",
          TRUE,
          (
            readiness."read_surface_deactivation_confirmed" = TRUE
            AND readiness."is_ready" = TRUE
          ),
          CASE
            WHEN readiness."read_surface_deactivation_confirmed" IS DISTINCT FROM TRUE THEN
              'read_surface_deactivation_confirmed must be TRUE before destructive share-table drop.'
            WHEN readiness."is_ready" IS DISTINCT FROM TRUE THEN
              'execution readiness checkpoint must be marked ready before destructive share-table drop.'
            ELSE
              'authorized'
          END
        FROM latest_execution_readiness readiness
        CROSS JOIN (
          VALUES
            ('vfs_shares', 'step-1'),
            ('org_shares', 'step-2')
        ) AS candidates("candidate_table", "planned_step")
      `);

      await pool.query('COMMIT');
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  }
};

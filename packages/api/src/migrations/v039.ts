import type { Pool } from 'pg';
import type { Migration } from './types.js';

/**
 * v039: Stage share-retirement pre-drop execution readiness guardrails.
 *
 * Non-destructive scaffolding migration that records an explicit execution
 * readiness contract for legacy share-table retirement. This migration does not
 * drop tables. It fails closed unless v038 dry-run candidates/parity still hold
 * and captures the required read-surface deactivation marker that a future
 * destructive migration must enforce.
 */
export const v039: Migration = {
  version: 39,
  description: 'Record share pre-drop execution readiness guardrails',
  up: async (pool: Pool) => {
    await pool.query('BEGIN');
    try {
      await pool.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1
            FROM "schema_migrations"
            WHERE "version" = 38
          ) THEN
            RAISE EXCEPTION
              'v039 abort: v038 must be recorded before share pre-drop execution readiness';
          END IF;

          IF to_regclass('public.vfs_acl_entries') IS NULL THEN
            RAISE EXCEPTION
              'v039 abort: vfs_acl_entries missing before share pre-drop execution readiness';
          END IF;

          IF to_regclass('public.vfs_shares') IS NULL THEN
            RAISE EXCEPTION
              'v039 abort: vfs_shares missing before share pre-drop execution readiness';
          END IF;

          IF to_regclass('public.org_shares') IS NULL THEN
            RAISE EXCEPTION
              'v039 abort: org_shares missing before share pre-drop execution readiness';
          END IF;

          IF to_regclass('public.vfs_share_retirement_drop_candidates') IS NULL THEN
            RAISE EXCEPTION
              'v039 abort: share drop-candidate checkpoints missing before share pre-drop execution readiness';
          END IF;

          IF NOT EXISTS (
            SELECT 1
            FROM "vfs_share_retirement_drop_candidates"
            WHERE "candidate_table" = 'vfs_shares'
              AND "is_ready" = TRUE
          ) THEN
            RAISE EXCEPTION
              'v039 abort: vfs_shares drop-candidate readiness checkpoint missing before execution readiness';
          END IF;

          IF NOT EXISTS (
            SELECT 1
            FROM "vfs_share_retirement_drop_candidates"
            WHERE "candidate_table" = 'org_shares'
              AND "is_ready" = TRUE
          ) THEN
            RAISE EXCEPTION
              'v039 abort: org_shares drop-candidate readiness checkpoint missing before execution readiness';
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
              'v039 abort: vfs_shares rows missing canonical active ACL parity';
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
              'v039 abort: org_shares rows missing canonical active ACL parity';
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
              'v039 abort: share-sourced ACL rows orphaned from vfs_shares';
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
              'v039 abort: org-share-sourced ACL rows orphaned from org_shares';
          END IF;
        END;
        $$;
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS "vfs_share_retirement_execution_readiness" (
          "id" BIGSERIAL PRIMARY KEY,
          "captured_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          "required_marker" TEXT NOT NULL,
          "legacy_read_surface_inventory" TEXT NOT NULL,
          "canonical_read_contract" TEXT NOT NULL,
          "read_surface_deactivation_confirmed" BOOLEAN NOT NULL,
          "is_ready" BOOLEAN NOT NULL,
          "blocking_reason" TEXT NOT NULL
        )
      `);

      await pool.query(`
        INSERT INTO "vfs_share_retirement_execution_readiness" (
          "required_marker",
          "legacy_read_surface_inventory",
          "canonical_read_contract",
          "read_surface_deactivation_confirmed",
          "is_ready",
          "blocking_reason"
        )
        VALUES (
          'legacy_share_read_surfaces_deactivated',
          'GET /v1/vfs/items/:itemId/shares; loadShareAuthorizationContext; loadOrgShareAuthorizationContext',
          'acl-first-share-read-path-with-transition-parity',
          FALSE,
          FALSE,
          'Legacy share-read surfaces must be deactivated and parity-validated before destructive share-table retirement.'
        )
      `);

      await pool.query('COMMIT');
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  }
};

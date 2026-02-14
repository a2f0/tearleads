import type { Pool } from 'pg';
import type { Migration } from './types.js';

/**
 * v037: Record share-retirement drop-planning checkpoints.
 *
 * Non-destructive scaffolding migration that records a planning snapshot only
 * after v036 preconditions remain satisfied. This gives rollout/ops an explicit
 * artifact for sequencing eventual destructive share-table retirement work.
 */
export const v037: Migration = {
  version: 37,
  description: 'Record share-retirement drop-planning checkpoint',
  up: async (pool: Pool) => {
    await pool.query('BEGIN');
    try {
      await pool.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1
            FROM "schema_migrations"
            WHERE "version" = 36
          ) THEN
            RAISE EXCEPTION
              'v037 abort: v036 must be recorded before share drop-planning checkpoint';
          END IF;

          IF to_regclass('public.vfs_acl_entries') IS NULL THEN
            RAISE EXCEPTION
              'v037 abort: vfs_acl_entries missing before share drop-planning checkpoint';
          END IF;

          IF to_regclass('public.vfs_shares') IS NULL THEN
            RAISE EXCEPTION
              'v037 abort: vfs_shares missing before share drop-planning checkpoint';
          END IF;

          IF to_regclass('public.org_shares') IS NULL THEN
            RAISE EXCEPTION
              'v037 abort: org_shares missing before share drop-planning checkpoint';
          END IF;

          IF to_regclass('public.vfs_share_retirement_checkpoints') IS NULL THEN
            RAISE EXCEPTION
              'v037 abort: share retirement checkpoints missing before share drop-planning checkpoint';
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM "vfs_share_retirement_checkpoints"
          ) THEN
            RAISE EXCEPTION
              'v037 abort: no share retirement checkpoint rows recorded before share drop-planning checkpoint';
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
              'v037 abort: vfs_shares rows missing canonical active ACL parity';
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
              'v037 abort: org_shares rows missing canonical active ACL parity';
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
              'v037 abort: share-sourced ACL rows orphaned from vfs_shares';
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
              'v037 abort: org-share-sourced ACL rows orphaned from org_shares';
          END IF;
        END;
        $$;
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS "vfs_share_retirement_drop_plans" (
          "id" BIGSERIAL PRIMARY KEY,
          "captured_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          "planned_drop_order" TEXT NOT NULL,
          "legacy_vfs_shares_count" BIGINT NOT NULL,
          "legacy_org_shares_count" BIGINT NOT NULL,
          "canonical_active_share_acl_count" BIGINT NOT NULL,
          "canonical_active_org_acl_count" BIGINT NOT NULL
        )
      `);

      await pool.query(`
        INSERT INTO "vfs_share_retirement_drop_plans" (
          "planned_drop_order",
          "legacy_vfs_shares_count",
          "legacy_org_shares_count",
          "canonical_active_share_acl_count",
          "canonical_active_org_acl_count"
        )
        VALUES (
          'vfs_shares_then_org_shares',
          (SELECT COUNT(*) FROM "vfs_shares"),
          (SELECT COUNT(*) FROM "org_shares"),
          (
            SELECT COUNT(*)
            FROM "vfs_acl_entries"
            WHERE "revoked_at" IS NULL
              AND "id" LIKE 'share:%'
          ),
          (
            SELECT COUNT(*)
            FROM "vfs_acl_entries"
            WHERE "revoked_at" IS NULL
              AND "id" LIKE 'org-share:%'
          )
        )
      `);

      await pool.query('COMMIT');
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  }
};

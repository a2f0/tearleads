import type { Pool } from 'pg';
import type { Migration } from './types.js';

/**
 * v035: Stage share-retirement checkpoints for vfs_shares + org_shares.
 *
 * This migration is intentionally non-destructive. It does not drop share
 * tables yet; it records a guarded checkpoint proving canonical ACL parity is
 * stable before any future retirement migration is considered.
 *
 * Guardrails:
 * 1) Legacy share tables and canonical ACL table must all exist.
 * 2) Legacy -> canonical active principal parity mismatches must be zero.
 * 3) Canonical ACL rows carrying legacy share source IDs must not become
 *    orphaned from their corresponding legacy rows.
 */
export const v035: Migration = {
  version: 35,
  description: 'Record vfs_shares/org_shares retirement checkpoint snapshot',
  up: async (pool: Pool) => {
    await pool.query('BEGIN');
    try {
      await pool.query(`
        DO $$
        BEGIN
          IF to_regclass('public.vfs_acl_entries') IS NULL THEN
            RAISE EXCEPTION
              'v035 abort: vfs_acl_entries missing before share retirement checkpoint';
          END IF;

          IF to_regclass('public.vfs_shares') IS NULL THEN
            RAISE EXCEPTION
              'v035 abort: vfs_shares missing before share retirement checkpoint';
          END IF;

          IF to_regclass('public.org_shares') IS NULL THEN
            RAISE EXCEPTION
              'v035 abort: org_shares missing before share retirement checkpoint';
          END IF;
        END;
        $$;
      `);

      await pool.query(`
        DO $$
        DECLARE missing_vfs_share_acl_count BIGINT;
        DECLARE missing_org_share_acl_count BIGINT;
        DECLARE orphaned_vfs_share_source_acl_count BIGINT;
        DECLARE orphaned_org_share_source_acl_count BIGINT;
        BEGIN
          /*
           * Match semantics must stay aligned with share-route dual writes and
           * v028/v029 parity scaffolding:
           * - permission_level edit -> access_level write
           * - view/download -> read
           */
          SELECT COUNT(*) INTO missing_vfs_share_acl_count
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
          WHERE acl.id IS NULL;

          SELECT COUNT(*) INTO missing_org_share_acl_count
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
          WHERE acl.id IS NULL;

          /*
           * Source-ID guardrail:
           * If canonical rows still carry legacy source IDs ('share:*',
           * 'org-share:*'), they must continue to point to extant legacy rows.
           * This prevents silent drift in rollback/audit paths.
           */
          SELECT COUNT(*) INTO orphaned_vfs_share_source_acl_count
          FROM "vfs_acl_entries" acl
          LEFT JOIN "vfs_shares" s
            ON s.id = SUBSTRING(acl.id FROM 7)
          WHERE acl.id LIKE 'share:%'
            AND s.id IS NULL;

          SELECT COUNT(*) INTO orphaned_org_share_source_acl_count
          FROM "vfs_acl_entries" acl
          LEFT JOIN "org_shares" os
            ON os.id = SUBSTRING(acl.id FROM 11)
          WHERE acl.id LIKE 'org-share:%'
            AND os.id IS NULL;

          IF missing_vfs_share_acl_count <> 0 THEN
            RAISE EXCEPTION
              'v035 abort: vfs_shares active ACL parity mismatches remain (% rows)',
              missing_vfs_share_acl_count;
          END IF;

          IF missing_org_share_acl_count <> 0 THEN
            RAISE EXCEPTION
              'v035 abort: org_shares active ACL parity mismatches remain (% rows)',
              missing_org_share_acl_count;
          END IF;

          IF orphaned_vfs_share_source_acl_count <> 0 THEN
            RAISE EXCEPTION
              'v035 abort: share-sourced ACL rows are orphaned from vfs_shares (% rows)',
              orphaned_vfs_share_source_acl_count;
          END IF;

          IF orphaned_org_share_source_acl_count <> 0 THEN
            RAISE EXCEPTION
              'v035 abort: org-share-sourced ACL rows are orphaned from org_shares (% rows)',
              orphaned_org_share_source_acl_count;
          END IF;
        END;
        $$;
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS "vfs_share_retirement_checkpoints" (
          "id" BIGSERIAL PRIMARY KEY,
          "captured_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          "legacy_vfs_shares_count" BIGINT NOT NULL,
          "legacy_org_shares_count" BIGINT NOT NULL,
          "missing_vfs_share_acl_count" BIGINT NOT NULL,
          "missing_org_share_acl_count" BIGINT NOT NULL,
          "orphaned_vfs_share_source_acl_count" BIGINT NOT NULL,
          "orphaned_org_share_source_acl_count" BIGINT NOT NULL
        )
      `);

      await pool.query(`
        INSERT INTO "vfs_share_retirement_checkpoints" (
          "legacy_vfs_shares_count",
          "legacy_org_shares_count",
          "missing_vfs_share_acl_count",
          "missing_org_share_acl_count",
          "orphaned_vfs_share_source_acl_count",
          "orphaned_org_share_source_acl_count"
        )
        VALUES (
          (SELECT COUNT(*) FROM "vfs_shares"),
          (SELECT COUNT(*) FROM "org_shares"),
          (
            SELECT COUNT(*)
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
          ),
          (
            SELECT COUNT(*)
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
          ),
          (
            SELECT COUNT(*)
            FROM "vfs_acl_entries" acl
            LEFT JOIN "vfs_shares" s
              ON s.id = SUBSTRING(acl.id FROM 7)
            WHERE acl.id LIKE 'share:%'
              AND s.id IS NULL
          ),
          (
            SELECT COUNT(*)
            FROM "vfs_acl_entries" acl
            LEFT JOIN "org_shares" os
              ON os.id = SUBSTRING(acl.id FROM 11)
            WHERE acl.id LIKE 'org-share:%'
              AND os.id IS NULL
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

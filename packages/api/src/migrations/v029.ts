import type { Pool } from 'pg';
import type { Migration } from './types.js';

/**
 * v029: Backfill and verify org_shares ACL parity ahead of retirement.
 *
 * Scaffolding-only (non-destructive): this migration projects org-share rows
 * into canonical ACL state and fails closed if post-backfill parity does not
 * hold. It intentionally avoids dropping org_shares until replacement reads are
 * fully staged.
 */
export const v029: Migration = {
  version: 29,
  description: 'Backfill and verify org_shares canonical ACL parity',
  up: async (pool: Pool) => {
    await pool.query('BEGIN');
    try {
      await pool.query(`
        DO $$
        BEGIN
          IF to_regclass('public.org_shares') IS NOT NULL
             AND to_regclass('public.vfs_acl_entries') IS NULL THEN
            RAISE EXCEPTION
              'v029 abort: vfs_acl_entries missing while org_shares still exists';
          END IF;
        END;
        $$;
      `);

      await pool.query(`
        INSERT INTO "vfs_acl_entries" (
          "id",
          "item_id",
          "principal_type",
          "principal_id",
          "access_level",
          "wrapped_session_key",
          "wrapped_hierarchical_key",
          "granted_by",
          "created_at",
          "updated_at",
          "expires_at",
          "revoked_at"
        )
        SELECT
          'org-share:' || os.id,
          os.item_id,
          'organization',
          os.target_org_id,
          CASE os.permission_level
            WHEN 'edit' THEN 'write'
            ELSE 'read'
          END,
          NULL,
          NULL,
          os.created_by,
          os.created_at,
          os.created_at,
          os.expires_at,
          NULL
        FROM "org_shares" os
        ON CONFLICT ("item_id", "principal_type", "principal_id")
        DO UPDATE SET
          "access_level" = EXCLUDED.access_level,
          "granted_by" = EXCLUDED.granted_by,
          "updated_at" = EXCLUDED.updated_at,
          "expires_at" = EXCLUDED.expires_at,
          "revoked_at" = NULL
      `);

      await pool.query(`
        DO $$
        BEGIN
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
              'v029 abort: org_shares rows missing canonical active ACL parity';
          END IF;
        END;
        $$;
      `);

      await pool.query('COMMIT');
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  }
};

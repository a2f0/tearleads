import type { Pool } from 'pg';
import type { Migration } from './types.js';

/**
 * v028: Backfill and verify vfs_shares ACL parity ahead of retirement.
 *
 * This is an explicit scaffolding migration: it does not drop `vfs_shares`.
 * Instead, it enforces canonical parity by projecting legacy share rows into
 * `vfs_acl_entries` and then validating active-principal equivalence.
 *
 * Guardrails:
 * 1) If `vfs_shares` exists, `vfs_acl_entries` must exist.
 * 2) Every share principal must have a canonical active ACL row after backfill.
 * 3) Permission mapping is fail-closed:
 *    - edit -> write
 *    - view/download -> read
 */
export const v028: Migration = {
  version: 28,
  description: 'Backfill and verify vfs_shares canonical ACL parity',
  up: async (pool: Pool) => {
    await pool.query('BEGIN');
    try {
      await pool.query(`
        DO $$
        BEGIN
          IF to_regclass('public.vfs_shares') IS NOT NULL
             AND to_regclass('public.vfs_acl_entries') IS NULL THEN
            RAISE EXCEPTION
              'v028 abort: vfs_acl_entries missing while vfs_shares still exists';
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
          'share:' || s.id,
          s.item_id,
          s.share_type,
          s.target_id,
          CASE s.permission_level
            WHEN 'edit' THEN 'write'
            ELSE 'read'
          END,
          NULL,
          NULL,
          s.created_by,
          s.created_at,
          s.created_at,
          s.expires_at,
          NULL
        FROM "vfs_shares" s
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
              'v028 abort: vfs_shares rows missing canonical active ACL parity';
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

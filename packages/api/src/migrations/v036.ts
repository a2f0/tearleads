import type { Pool } from 'pg';
import type { Migration } from './types.js';

/**
 * v036: Verify share-retirement preconditions after checkpoint scaffolding.
 *
 * Non-destructive guardrail migration that enforces readiness before any future
 * share-table drop candidate is introduced.
 *
 * Preconditions:
 * - canonical ACL table and both legacy share tables exist
 * - `vfs_share_retirement_checkpoints` exists with at least one row
 * - active-principal parity remains intact for vfs_shares and org_shares
 * - share-sourced canonical ACL rows are not orphaned from legacy rows
 */
export const v036: Migration = {
  version: 36,
  description: 'Verify share-retirement preconditions',
  up: async (pool: Pool) => {
    await pool.query('BEGIN');
    try {
      await pool.query(`
        DO $$
        BEGIN
          IF to_regclass('public.vfs_acl_entries') IS NULL THEN
            RAISE EXCEPTION
              'v036 abort: vfs_acl_entries missing before share retirement preconditions';
          END IF;

          IF to_regclass('public.vfs_shares') IS NULL THEN
            RAISE EXCEPTION
              'v036 abort: vfs_shares missing before share retirement preconditions';
          END IF;

          IF to_regclass('public.org_shares') IS NULL THEN
            RAISE EXCEPTION
              'v036 abort: org_shares missing before share retirement preconditions';
          END IF;

          IF to_regclass('public.vfs_share_retirement_checkpoints') IS NULL THEN
            RAISE EXCEPTION
              'v036 abort: share retirement checkpoints missing before precondition verification';
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM "vfs_share_retirement_checkpoints"
          ) THEN
            RAISE EXCEPTION
              'v036 abort: no share retirement checkpoint rows recorded before precondition verification';
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
              'v036 abort: vfs_shares rows missing canonical active ACL parity';
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
              'v036 abort: org_shares rows missing canonical active ACL parity';
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
              'v036 abort: share-sourced ACL rows orphaned from vfs_shares';
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
              'v036 abort: org-share-sourced ACL rows orphaned from org_shares';
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

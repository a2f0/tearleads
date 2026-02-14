import type { Pool } from 'pg';
import type { Migration } from './types.js';

/**
 * v027: Retire legacy vfs_access table after canonical ACL parity checks.
 *
 * Invariant guardrails for safe retirement:
 * 1) If vfs_access still exists, vfs_acl_entries must exist to represent the
 *    canonical flattened ACL model.
 * 2) Every legacy (item_id, user_id) grant must map to an active canonical
 *    user principal ACL row with matching access/key/expiry semantics.
 * 3) Table drop is allowed only when those checks pass.
 *
 * Any mismatch aborts migration fail-closed to avoid silently dropping legacy
 * grants that have not been reflected into the canonical ACL layer.
 */
export const v027: Migration = {
  version: 27,
  description: 'Retire transitional legacy vfs_access table',
  up: async (pool: Pool) => {
    await pool.query('BEGIN');
    try {
      await pool.query(`
        DO $$
        BEGIN
          IF to_regclass('public.vfs_access') IS NOT NULL THEN
            IF to_regclass('public.vfs_acl_entries') IS NULL THEN
              RAISE EXCEPTION
                'v027 abort: vfs_acl_entries missing while vfs_access still exists';
            END IF;

            IF EXISTS (
              SELECT 1
              FROM "vfs_access" legacy
              LEFT JOIN "vfs_acl_entries" acl
                ON acl.item_id = legacy.item_id
               AND acl.principal_type = 'user'
               AND acl.principal_id = legacy.user_id
               AND acl.revoked_at IS NULL
               AND acl.access_level = legacy.permission_level
               AND acl.wrapped_session_key IS NOT DISTINCT FROM legacy.wrapped_session_key
               AND acl.wrapped_hierarchical_key IS NOT DISTINCT FROM legacy.wrapped_hierarchical_key
               AND acl.granted_by IS NOT DISTINCT FROM legacy.granted_by
               AND acl.expires_at IS NOT DISTINCT FROM legacy.expires_at
              WHERE acl.id IS NULL
            ) THEN
              RAISE EXCEPTION
                'v027 abort: legacy vfs_access rows missing canonical active user ACL parity';
            END IF;
          END IF;
        END;
        $$;
      `);

      await pool.query('DROP TABLE IF EXISTS "vfs_access"');

      await pool.query('COMMIT');
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  }
};

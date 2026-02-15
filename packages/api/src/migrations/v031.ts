import type { Pool } from 'pg';
import type { Migration } from './types.js';

/**
 * v031: Enforce folder metadata retirement preconditions.
 *
 * Non-destructive guardrail-only migration that validates canonical/legacy
 * parity before any future `vfs_folders` drop. This migration intentionally
 * performs no data writes or DDL drops.
 */
export const v031: Migration = {
  version: 31,
  description: 'Verify vfs_folders retirement parity preconditions',
  up: async (pool: Pool) => {
    await pool.query('BEGIN');
    try {
      await pool.query(`
        DO $$
        BEGIN
          IF to_regclass('public.vfs_folders') IS NOT NULL
             AND to_regclass('public.vfs_registry') IS NULL THEN
            RAISE EXCEPTION
              'v031 abort: vfs_registry missing while vfs_folders still exists';
          END IF;
        END;
        $$;
      `);

      await pool.query(`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1
            FROM "vfs_folders" f
            LEFT JOIN "vfs_registry" r
              ON r.id = f.id
            WHERE r.id IS NULL
               OR r.object_type <> 'folder'
          ) THEN
            RAISE EXCEPTION
              'v031 abort: vfs_folders rows missing canonical folder registry identities';
          END IF;
        END;
        $$;
      `);

      await pool.query(`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1
            FROM "vfs_registry" r
            WHERE r.object_type = 'folder'
              AND NOT EXISTS (
                SELECT 1
                FROM "vfs_folders" f
                WHERE f.id = r.id
              )
          ) THEN
            RAISE EXCEPTION
              'v031 abort: canonical folder rows missing legacy vfs_folders rows';
          END IF;
        END;
        $$;
      `);

      await pool.query(`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1
            FROM "vfs_folders" f
            INNER JOIN "vfs_registry" r
              ON r.id = f.id
            WHERE r.encrypted_name IS DISTINCT FROM f.encrypted_name
               OR r.icon IS DISTINCT FROM f.icon
               OR r.view_mode IS DISTINCT FROM f.view_mode
               OR r.default_sort IS DISTINCT FROM f.default_sort
               OR r.sort_direction IS DISTINCT FROM f.sort_direction
          ) THEN
            RAISE EXCEPTION
              'v031 abort: vfs_folders rows missing canonical folder metadata parity';
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

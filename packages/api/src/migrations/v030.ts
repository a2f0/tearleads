import type { Pool } from 'pg';
import type { Migration } from './types.js';

/**
 * v030: Backfill folder metadata into vfs_registry for vfs_folders retirement.
 *
 * Scaffolding-only (non-destructive): this migration introduces canonical
 * folder metadata columns on vfs_registry, backfills from legacy vfs_folders,
 * and fails closed if parity checks do not hold.
 *
 * No table drop occurs here. This prepares read-path cutover work so vfs_folders
 * can be retired in a later migration with explicit rollback checkpoints.
 */
export const v030: Migration = {
  version: 30,
  description: 'Backfill folder metadata into canonical vfs_registry columns',
  up: async (pool: Pool) => {
    await pool.query('BEGIN');
    try {
      await pool.query(`
        DO $$
        BEGIN
          IF to_regclass('public.vfs_folders') IS NOT NULL
             AND to_regclass('public.vfs_registry') IS NULL THEN
            RAISE EXCEPTION
              'v030 abort: vfs_registry missing while vfs_folders still exists';
          END IF;
        END;
        $$;
      `);

      await pool.query(`
        ALTER TABLE "vfs_registry"
        ADD COLUMN IF NOT EXISTS "encrypted_name" TEXT,
        ADD COLUMN IF NOT EXISTS "icon" TEXT,
        ADD COLUMN IF NOT EXISTS "view_mode" TEXT,
        ADD COLUMN IF NOT EXISTS "default_sort" TEXT,
        ADD COLUMN IF NOT EXISTS "sort_direction" TEXT
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
              'v030 abort: vfs_folders rows missing canonical folder registry identities';
          END IF;
        END;
        $$;
      `);

      await pool.query(`
        UPDATE "vfs_registry" r
        SET
          "encrypted_name" = f.encrypted_name,
          "icon" = f.icon,
          "view_mode" = f.view_mode,
          "default_sort" = f.default_sort,
          "sort_direction" = f.sort_direction
        FROM "vfs_folders" f
        WHERE r.id = f.id
          AND (
            r.encrypted_name IS DISTINCT FROM f.encrypted_name
            OR r.icon IS DISTINCT FROM f.icon
            OR r.view_mode IS DISTINCT FROM f.view_mode
            OR r.default_sort IS DISTINCT FROM f.default_sort
            OR r.sort_direction IS DISTINCT FROM f.sort_direction
          )
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
              'v030 abort: vfs_folders rows missing canonical folder metadata parity';
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

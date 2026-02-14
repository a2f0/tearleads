import type { Pool } from 'pg';
import type { Migration } from './types.js';

/**
 * v033: Drop legacy vfs_folders after guardrailed retirement checkpoints.
 *
 * Destructive migration gated by v031/v032 preconditions:
 * - canonical registry must exist
 * - retirement checkpoints must be present
 * - canonical/legacy folder metadata parity must still hold at execution time
 */
export const v033: Migration = {
  version: 33,
  description: 'Drop legacy vfs_folders after retirement checkpoints',
  up: async (pool: Pool) => {
    await pool.query('BEGIN');
    try {
      await pool.query(`
        DO $$
        BEGIN
          IF to_regclass('public.vfs_registry') IS NULL THEN
            RAISE EXCEPTION
              'v033 abort: vfs_registry missing before vfs_folders drop';
          END IF;

          IF to_regclass('public.vfs_folder_retirement_checkpoints') IS NULL THEN
            RAISE EXCEPTION
              'v033 abort: retirement checkpoints missing before vfs_folders drop';
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM "vfs_folder_retirement_checkpoints"
          ) THEN
            RAISE EXCEPTION
              'v033 abort: no retirement checkpoint rows recorded before vfs_folders drop';
          END IF;
        END;
        $$;
      `);

      await pool.query(`
        DO $$
        BEGIN
          IF to_regclass('public.vfs_folders') IS NULL THEN
            RAISE EXCEPTION
              'v033 abort: vfs_folders already missing before guarded drop';
          END IF;

          IF EXISTS (
            SELECT 1
            FROM "vfs_folders" f
            INNER JOIN "vfs_registry" r
              ON r.id = f.id
            WHERE r.object_type <> 'folder'
               OR r.encrypted_name IS DISTINCT FROM f.encrypted_name
               OR r.icon IS DISTINCT FROM f.icon
               OR r.view_mode IS DISTINCT FROM f.view_mode
               OR r.default_sort IS DISTINCT FROM f.default_sort
               OR r.sort_direction IS DISTINCT FROM f.sort_direction
          ) THEN
            RAISE EXCEPTION
              'v033 abort: vfs_folders metadata parity check failed at drop time';
          END IF;
        END;
        $$;
      `);

      await pool.query(`DROP TABLE "vfs_folders"`);

      await pool.query('COMMIT');
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  }
};

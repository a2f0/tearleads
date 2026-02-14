import type { Pool } from 'pg';
import type { Migration } from './types.js';

/**
 * v034: Finalize vfs_folders retirement after guarded drop in v033.
 *
 * This keeps migration ordering explicit and fail-closed:
 * - vfs_registry must remain present for canonical folder metadata.
 * - vfs_folders must already be absent (v033 succeeded).
 * - retirement checkpoints must exist with at least one recorded row.
 *
 * After those invariants hold, we retire the checkpoint table so the runtime
 * schema no longer carries one-off migration scaffolding.
 */
export const v034: Migration = {
  version: 34,
  description: 'Finalize vfs_folders retirement checkpoint cleanup',
  up: async (pool: Pool) => {
    await pool.query('BEGIN');
    try {
      await pool.query(`
        DO $$
        BEGIN
          IF to_regclass('public.vfs_registry') IS NULL THEN
            RAISE EXCEPTION
              'v034 abort: vfs_registry missing during folder retirement finalization';
          END IF;

          IF to_regclass('public.vfs_folder_retirement_checkpoints') IS NULL THEN
            RAISE EXCEPTION
              'v034 abort: retirement checkpoints missing during folder retirement finalization';
          END IF;

          IF to_regclass('public.vfs_folders') IS NOT NULL THEN
            RAISE EXCEPTION
              'v034 abort: vfs_folders still exists before folder retirement finalization';
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM "vfs_folder_retirement_checkpoints"
          ) THEN
            RAISE EXCEPTION
              'v034 abort: no retirement checkpoint rows recorded before folder retirement finalization';
          END IF;
        END;
        $$;
      `);

      await pool.query(`DROP TABLE "vfs_folder_retirement_checkpoints"`);

      await pool.query('COMMIT');
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  }
};

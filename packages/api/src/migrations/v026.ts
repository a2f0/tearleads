import type { Pool } from 'pg';
import type { Migration } from './types.js';

/**
 * v026: Retire legacy blob object metadata table
 *
 * Blob metadata is now represented by canonical `vfs_registry` rows
 * (`object_type = 'blob'`) plus object-store state. Before dropping the legacy
 * table, enforce a parity guard so no blob IDs are lost during the cutover.
 */
export const v026: Migration = {
  version: 26,
  description: 'Retire transitional blob object metadata table',
  up: async (pool: Pool) => {
    await pool.query('BEGIN');
    try {
      await pool.query(`
        DO $$
        BEGIN
          IF to_regclass('public.vfs_blob_objects') IS NOT NULL
             AND EXISTS (
               SELECT 1
               FROM "vfs_blob_objects" bo
               LEFT JOIN "vfs_registry" vr
                 ON vr.id = bo.id
               WHERE vr.id IS NULL
                  OR vr.object_type <> 'blob'
             ) THEN
            RAISE EXCEPTION
              'v026 abort: legacy blob objects missing canonical blob representation';
          END IF;
        END;
        $$;
      `);

      await pool.query('DROP TABLE IF EXISTS "vfs_blob_objects"');

      await pool.query('COMMIT');
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  }
};

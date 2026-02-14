import type { Pool } from 'pg';
import type { Migration } from './types.js';

/**
 * v025: Retire legacy blob staging/reference tables after flattened cutover
 *
 * v024 backfills legacy rows into blobStage records represented by
 * vfs_registry + vfs_links. This migration verifies backfill parity and then
 * removes transitional tables that are no longer used by runtime routes.
 */
export const v025: Migration = {
  version: 25,
  description: 'Retire transitional blob staging and reference tables',
  up: async (pool: Pool) => {
    await pool.query('BEGIN');
    try {
      await pool.query(`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1
            FROM "vfs_blob_staging" s
            LEFT JOIN "vfs_links" l
              ON l.id = s.id
            LEFT JOIN "vfs_registry" r
              ON r.id = s.id
            WHERE l.id IS NULL
              OR r.id IS NULL
              OR r.object_type <> 'blobStage'
          ) THEN
            RAISE EXCEPTION
              'v025 abort: legacy staged rows missing flattened blobStage representation';
          END IF;
        END;
        $$;
      `);

      await pool.query('DROP TABLE IF EXISTS "vfs_blob_refs"');
      await pool.query('DROP TABLE IF EXISTS "vfs_blob_staging"');

      await pool.query('COMMIT');
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  }
};

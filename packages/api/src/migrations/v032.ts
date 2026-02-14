import type { Pool } from 'pg';
import type { Migration } from './types.js';

/**
 * v032: Stage folder retirement checkpoint scaffold.
 *
 * Non-destructive migration that blocks if canonical/legacy folder counts or
 * metadata parity diverge, then records an explicit checkpoint snapshot used by
 * future drop migrations and rollback runbooks.
 */
export const v032: Migration = {
  version: 32,
  description: 'Record vfs_folders retirement checkpoint snapshot',
  up: async (pool: Pool) => {
    await pool.query('BEGIN');
    try {
      await pool.query(`
        DO $$
        BEGIN
          IF to_regclass('public.vfs_registry') IS NULL THEN
            RAISE EXCEPTION
              'v032 abort: vfs_registry missing before folder retirement checkpoint';
          END IF;

          IF to_regclass('public.vfs_folders') IS NULL THEN
            RAISE EXCEPTION
              'v032 abort: vfs_folders missing before folder retirement checkpoint';
          END IF;
        END;
        $$;
      `);

      await pool.query(`
        DO $$
        DECLARE canonical_count BIGINT;
        DECLARE legacy_count BIGINT;
        DECLARE mismatch_count BIGINT;
        BEGIN
          SELECT COUNT(*) INTO canonical_count
          FROM "vfs_registry"
          WHERE object_type = 'folder';

          SELECT COUNT(*) INTO legacy_count
          FROM "vfs_folders";

          SELECT COUNT(*) INTO mismatch_count
          FROM "vfs_folders" f
          INNER JOIN "vfs_registry" r
            ON r.id = f.id
          WHERE r.object_type <> 'folder'
             OR r.encrypted_name IS DISTINCT FROM f.encrypted_name
             OR r.icon IS DISTINCT FROM f.icon
             OR r.view_mode IS DISTINCT FROM f.view_mode
             OR r.default_sort IS DISTINCT FROM f.default_sort
             OR r.sort_direction IS DISTINCT FROM f.sort_direction;

          IF canonical_count <> legacy_count THEN
            RAISE EXCEPTION
              'v032 abort: folder retirement counts diverged (canonical %, legacy %)',
              canonical_count,
              legacy_count;
          END IF;

          IF mismatch_count <> 0 THEN
            RAISE EXCEPTION
              'v032 abort: folder retirement metadata mismatches remain (% rows)',
              mismatch_count;
          END IF;
        END;
        $$;
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS "vfs_folder_retirement_checkpoints" (
          "id" BIGSERIAL PRIMARY KEY,
          "captured_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          "canonical_folder_count" BIGINT NOT NULL,
          "legacy_folder_count" BIGINT NOT NULL,
          "metadata_mismatch_count" BIGINT NOT NULL
        )
      `);

      await pool.query(`
        INSERT INTO "vfs_folder_retirement_checkpoints" (
          "canonical_folder_count",
          "legacy_folder_count",
          "metadata_mismatch_count"
        )
        VALUES (
          (SELECT COUNT(*) FROM "vfs_registry" WHERE object_type = 'folder'),
          (SELECT COUNT(*) FROM "vfs_folders"),
          (
            SELECT COUNT(*)
            FROM "vfs_folders" f
            INNER JOIN "vfs_registry" r
              ON r.id = f.id
            WHERE r.object_type <> 'folder'
               OR r.encrypted_name IS DISTINCT FROM f.encrypted_name
               OR r.icon IS DISTINCT FROM f.icon
               OR r.view_mode IS DISTINCT FROM f.view_mode
               OR r.default_sort IS DISTINCT FROM f.default_sort
               OR r.sort_direction IS DISTINCT FROM f.sort_direction
          )
        )
      `);

      await pool.query('COMMIT');
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  }
};

import type { Pool } from 'pg';
import type { Migration } from './types.js';

/**
 * v024: Backfill legacy blob staging rows into flattened VFS representation
 *
 * Legacy runtime paths wrote staged state into vfs_blob_staging. Current blob
 * lifecycle now relies on:
 * - vfs_registry rows with object_type = 'blob' / 'blobStage'
 * - vfs_links rows keyed by stagingId with blob-stage:* status keys
 *
 * This migration projects legacy rows forward while preserving attach/abandon
 * terminal states and failing closed on object-type collisions.
 */
export const v024: Migration = {
  version: 24,
  description: 'Backfill legacy blob staging rows into flattened VFS links',
  up: async (pool: Pool) => {
    await pool.query('BEGIN');
    try {
      await pool.query(`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1
            FROM "vfs_blob_objects" bo
            INNER JOIN "vfs_registry" vr
              ON vr.id = bo.id
            WHERE vr.object_type <> 'blob'
          ) THEN
            RAISE EXCEPTION
              'v024 backfill conflict: blob object id collides with non-blob vfs_registry row';
          END IF;
        END;
        $$;
      `);

      await pool.query(`
        INSERT INTO "vfs_registry" (
          "id",
          "object_type",
          "owner_id",
          "created_at"
        )
        SELECT
          bo.id,
          'blob',
          bo.created_by,
          bo.created_at
        FROM "vfs_blob_objects" bo
        LEFT JOIN "vfs_registry" vr
          ON vr.id = bo.id
        WHERE vr.id IS NULL
        ON CONFLICT ("id") DO NOTHING
      `);

      await pool.query(`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1
            FROM "vfs_blob_staging" s
            INNER JOIN "vfs_registry" vr
              ON vr.id = s.id
            WHERE vr.object_type <> 'blobStage'
          ) THEN
            RAISE EXCEPTION
              'v024 backfill conflict: staging id collides with non-blobStage vfs_registry row';
          END IF;
        END;
        $$;
      `);

      await pool.query(`
        INSERT INTO "vfs_registry" (
          "id",
          "object_type",
          "owner_id",
          "created_at"
        )
        SELECT
          s.id,
          'blobStage',
          s.staged_by,
          s.staged_at
        FROM "vfs_blob_staging" s
        LEFT JOIN "vfs_registry" vr
          ON vr.id = s.id
        WHERE vr.id IS NULL
        ON CONFLICT ("id") DO NOTHING
      `);

      await pool.query(`
        INSERT INTO "vfs_links" (
          "id",
          "parent_id",
          "child_id",
          "wrapped_session_key",
          "visible_children",
          "created_at"
        )
        SELECT
          s.id,
          s.id,
          s.blob_id,
          CASE s.status
            WHEN 'staged' THEN 'blob-stage:staged'
            WHEN 'attached' THEN 'blob-stage:attached'
            WHEN 'abandoned' THEN 'blob-stage:abandoned'
            ELSE 'blob-stage:abandoned'
          END,
          jsonb_build_object(
            'status',
            s.status,
            'expiresAt',
            s.expires_at,
            'attachedAt',
            s.attached_at,
            'attachedItemId',
            s.attached_item_id
          )::json,
          s.staged_at
        FROM "vfs_blob_staging" s
        LEFT JOIN "vfs_links" l
          ON l.id = s.id
        WHERE l.id IS NULL
        ON CONFLICT ("id") DO NOTHING
      `);

      await pool.query('COMMIT');
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  }
};

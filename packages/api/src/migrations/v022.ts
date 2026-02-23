import type { Pool } from 'pg';
import type { Migration } from './types.js';

/**
 * v022: Add key_epoch column to vfs_acl_entries for tracking wrapped key epochs.
 *
 * This column tracks which key epoch the wrapped_session_key belongs to,
 * allowing clients to detect stale keys after rekey operations.
 */
export const v022: Migration = {
  version: 22,
  description:
    'Add key_epoch column to vfs_acl_entries for key rotation tracking',
  up: async (pool: Pool) => {
    await pool.query('BEGIN');
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS "vfs_acl_entries" (
          "id" TEXT PRIMARY KEY,
          "item_id" TEXT NOT NULL REFERENCES "vfs_registry"("id") ON DELETE CASCADE,
          "principal_type" TEXT NOT NULL CHECK ("principal_type" IN ('user', 'group', 'organization')),
          "principal_id" TEXT NOT NULL,
          "access_level" TEXT NOT NULL CHECK ("access_level" IN ('read', 'write', 'admin')),
          "wrapped_session_key" TEXT,
          "wrapped_hierarchical_key" TEXT,
          "key_epoch" INTEGER,
          "granted_by" TEXT REFERENCES "users"("id") ON DELETE RESTRICT,
          "created_at" TIMESTAMPTZ NOT NULL,
          "updated_at" TIMESTAMPTZ NOT NULL,
          "expires_at" TIMESTAMPTZ,
          "revoked_at" TIMESTAMPTZ
        )
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS "vfs_acl_entries_item_idx"
        ON "vfs_acl_entries" ("item_id")
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS "vfs_acl_entries_principal_idx"
        ON "vfs_acl_entries" ("principal_type", "principal_id")
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS "vfs_acl_entries_active_idx"
        ON "vfs_acl_entries" ("principal_type", "principal_id", "revoked_at", "expires_at")
      `);
      await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS "vfs_acl_entries_item_principal_idx"
        ON "vfs_acl_entries" ("item_id", "principal_type", "principal_id")
      `);

      await pool.query(`
        ALTER TABLE "vfs_acl_entries"
        ADD COLUMN IF NOT EXISTS "key_epoch" INTEGER
      `);

      await pool.query('COMMIT');
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  }
};

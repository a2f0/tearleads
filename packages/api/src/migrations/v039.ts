import type { Pool } from 'pg';
import type { Migration } from './types.js';

/**
 * v039: Add root_id to vfs_crdt_ops for optimized scoped sync.
 *
 * This migration:
 * 1. Adds root_id column to vfs_crdt_ops.
 * 2. Populates root_id from existing hierarchy.
 * 3. Adds an index for (root_id, occurred_at, id) to support fast scoped pulls.
 */
export const v039: Migration = {
  version: 39,
  description: 'Add root_id to vfs_crdt_ops',
  up: async (pool: Pool) => {
    await pool.query(`
      ALTER TABLE "vfs_crdt_ops" ADD COLUMN "root_id" UUID;

      -- Populate root_id for existing ops based on item_id's parent in vfs_links
      -- This is a best-effort for existing data in greenfield
      UPDATE "vfs_crdt_ops" ops
      SET root_id = COALESCE(
        (SELECT parent_id FROM vfs_links WHERE child_id = ops.item_id LIMIT 1),
        ops.item_id
      )
      WHERE root_id IS NULL;

      CREATE INDEX "idx_vfs_crdt_ops_root_scope" ON "vfs_crdt_ops" (root_id, occurred_at, id);
    `);
  }
};

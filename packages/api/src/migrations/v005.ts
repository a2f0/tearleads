import type { Pool } from 'pg';
import type { Migration } from './types.js';

/**
 * v005: Add link_reassign to vfs_crdt_ops op_type CHECK constraint.
 *
 * This migration drops the existing CHECK constraint on op_type and
 * re-creates it to include the new 'link_reassign' value.
 */
export const v005: Migration = {
  version: 5,
  description: 'Add link_reassign op_type to vfs_crdt_ops',
  up: async (pool: Pool) => {
    await pool.query(`
      ALTER TABLE "vfs_crdt_ops"
      DROP CONSTRAINT IF EXISTS "vfs_crdt_ops_op_type_check";

      ALTER TABLE "vfs_crdt_ops"
      ADD CONSTRAINT "vfs_crdt_ops_op_type_check"
      CHECK ("op_type" IN (
        'acl_add',
        'acl_remove',
        'link_add',
        'link_remove',
        'link_reassign',
        'item_upsert',
        'item_delete'
      ));
    `);
  }
};

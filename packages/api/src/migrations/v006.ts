import type { Pool } from 'pg';
import type { Migration } from './types.js';

/**
 * v006: Persist ACL operation signatures on vfs_crdt_ops rows.
 */
export const v006: Migration = {
  version: 6,
  description: 'Persist ACL operation signatures',
  up: async (pool: Pool) => {
    await pool.query(`
      ALTER TABLE "vfs_crdt_ops"
      ADD COLUMN IF NOT EXISTS "operation_signature" TEXT,
      ADD COLUMN IF NOT EXISTS "operation_signature_bytes" BYTEA;
    `);
  }
};

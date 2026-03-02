import type { Pool } from 'pg';
import type { Migration } from './types.js';

/**
 * v031: Speed up direct-provenance ACL guards.
 *
 * Compiler guard queries repeatedly probe `vfs_acl_entry_provenance` using
 * `(acl_entry_id, provenance_type)` lookups. This composite index avoids
 * unnecessary scans on large provenance tables.
 */
export const v031: Migration = {
  version: 31,
  description: 'Add direct-provenance lookup index for ACL compiler guards',
  up: async (pool: Pool) => {
    await pool.query(`
      CREATE INDEX IF NOT EXISTS "vfs_acl_entry_provenance_acl_type_idx"
      ON "vfs_acl_entry_provenance" ("acl_entry_id", "provenance_type")
    `);
  }
};

import type { Pool } from 'pg';
import type { Migration } from './types.js';

/**
 * v037: Drop legacy MLS message storage table.
 *
 * Runtime MLS reads/writes now flow through vfs_crdt_ops + vfs_registry mirrors.
 * Keep the historical creation migration (v014) intact and remove the obsolete
 * table in forward schema state.
 */
export const v037: Migration = {
  version: 37,
  description: 'Drop legacy mls_messages table',
  up: async (pool: Pool) => {
    await pool.query(`DROP TABLE IF EXISTS "mls_messages"`);
  }
};

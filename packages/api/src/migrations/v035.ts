import type { Pool } from 'pg';
import type { Migration } from './types.js';

/**
 * v035: Drop legacy standalone content tables.
 *
 * These tables were created in v001 before the VFS system existed.
 * All content is now managed through vfs_registry + VFS extension tables.
 * No server-side queries reference these tables outside of migration files.
 */
export const v035: Migration = {
  version: 35,
  description: 'Drop legacy standalone content tables',
  up: async (pool: Pool) => {
    // Drop child tables first (FK ordering)
    await pool.query(`DROP TABLE IF EXISTS "contact_phones"`);
    await pool.query(`DROP TABLE IF EXISTS "contact_emails"`);
    await pool.query(`DROP TABLE IF EXISTS "contacts"`);
    await pool.query(`DROP TABLE IF EXISTS "files"`);
    await pool.query(`DROP TABLE IF EXISTS "notes"`);
    await pool.query(`DROP TABLE IF EXISTS "sync_metadata"`);
    await pool.query(`DROP TABLE IF EXISTS "analytics_events"`);
    await pool.query(`DROP TABLE IF EXISTS "user_settings"`);
  }
};

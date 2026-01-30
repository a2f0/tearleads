import type { Pool } from 'pg';
import type { Migration } from './types.js';

/**
 * v011: Make vfs_registry.owner_id optional
 *
 * Device-first architecture: Items can be created without a user ID.
 * The ownerId will be populated when the user logs in and syncs.
 *
 * This migration:
 * 1. Drops the FK constraint on owner_id
 * 2. Makes owner_id nullable
 */
export const v011: Migration = {
  version: 11,
  description: 'Make vfs_registry.owner_id optional for device-first',
  up: async (pool: Pool) => {
    await pool.query('BEGIN');
    try {
      // Drop the foreign key constraint
      // PostgreSQL auto-names FK constraints as tablename_columnname_fkey
      await pool.query(`
        ALTER TABLE "vfs_registry"
        DROP CONSTRAINT IF EXISTS "vfs_registry_owner_id_fkey"
      `);

      // Make owner_id nullable
      await pool.query(`
        ALTER TABLE "vfs_registry"
        ALTER COLUMN "owner_id" DROP NOT NULL
      `);

      await pool.query('COMMIT');
    } catch (e) {
      await pool.query('ROLLBACK');
      throw e;
    }
  }
};

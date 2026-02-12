import type { Pool } from 'pg';
import type { Migration } from './types.js';

/**
 * v016: Add is_admin column to user_organizations table
 *
 * Adds:
 * - is_admin: Boolean flag indicating if user is an organization administrator
 */
export const v016: Migration = {
  version: 16,
  description: 'Add is_admin column to user_organizations table',
  up: async (pool: Pool) => {
    await pool.query('BEGIN');
    try {
      await pool.query(`
        ALTER TABLE "user_organizations"
        ADD COLUMN IF NOT EXISTS "is_admin" BOOLEAN NOT NULL DEFAULT FALSE
      `);
      await pool.query('COMMIT');
    } catch (e) {
      await pool.query('ROLLBACK');
      throw e;
    }
  }
};

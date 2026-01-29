import type { Pool } from 'pg';
import type { Migration } from './types.js';

/**
 * v009: Add timestamp columns to users table
 *
 * Adds created_at and updated_at columns to users table for registration tracking.
 */
export const v009: Migration = {
  version: 9,
  description: 'Add timestamp columns to users table',
  up: async (pool: Pool) => {
    await pool.query(
      'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMPTZ'
    );
    await pool.query(
      'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMPTZ'
    );
  }
};

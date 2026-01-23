import type { Pool } from 'pg';
import type { Migration } from './types.js';

/**
 * v005: Add admin flag to users
 *
 * Adds an admin boolean column to the users table.
 */
export const v005: Migration = {
  version: 5,
  description: 'Add admin flag to users',
  up: async (pool: Pool) => {
    await pool.query(
      'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "admin" BOOLEAN NOT NULL DEFAULT FALSE'
    );
  }
};

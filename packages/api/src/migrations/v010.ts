import type { Pool } from 'pg';
import type { Migration } from './types.js';

/**
 * v010: Add last_active_at column to users table
 *
 * Stores the most recent activity timestamp synced from Redis sessions.
 * Updated daily via cron job to persist session activity data.
 */
export const v010: Migration = {
  version: 10,
  description: 'Add last_active_at column to users table',
  up: async (pool: Pool) => {
    await pool.query(
      'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_active_at" TIMESTAMPTZ'
    );
  }
};

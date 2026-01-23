import type { Pool } from 'pg';
import type { Migration } from './types.js';

/**
 * v002: Add detail column to analytics_events
 *
 * Adds a JSONB column for additional event metadata.
 */
export const v002: Migration = {
  version: 2,
  description: 'Add detail column to analytics_events',
  up: async (pool: Pool) => {
    await pool.query(
      'ALTER TABLE "analytics_events" ADD COLUMN IF NOT EXISTS "detail" JSONB'
    );
  }
};

import type { Migration } from './types';
import { addColumnIfNotExists } from './utils';

/**
 * v002: Add detail JSONB column to analytics_events
 *
 * Adds a nullable JSON column to store additional event metadata.
 * Stored as TEXT in SQLite, JSONB in PostgreSQL.
 */
export const v002: Migration = {
  version: 2,
  description: 'Add detail column to analytics_events',
  up: async (adapter) => {
    await addColumnIfNotExists(adapter, 'analytics_events', 'detail', 'TEXT');
  }
};

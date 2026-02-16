import type { DatabaseAdapter } from '../adapters/types.js';

/**
 * Test migrations for common tables used across multiple test suites.
 * These create minimal versions of tables for testing purposes.
 *
 * Tables included:
 * - analytics_events: For testing analytics logging
 * - user_settings: For testing user preferences storage
 */
export const commonTestMigrations = [
  {
    version: 1,
    up: async (adapter: DatabaseAdapter) => {
      // Analytics events table
      await adapter.execute(`
        CREATE TABLE IF NOT EXISTS analytics_events (
          id TEXT PRIMARY KEY,
          event_name TEXT NOT NULL,
          duration_ms INTEGER NOT NULL,
          success INTEGER NOT NULL,
          timestamp INTEGER NOT NULL,
          detail TEXT
        )
      `);

      // User settings table
      await adapter.execute(`
        CREATE TABLE IF NOT EXISTS user_settings (
          key TEXT PRIMARY KEY,
          value TEXT,
          updated_at INTEGER NOT NULL
        )
      `);

      await adapter.execute('PRAGMA foreign_keys = ON');
    }
  }
];

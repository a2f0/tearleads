import type { DatabaseAdapter } from '../adapters/types.js';

/**
 * Test migrations for classic (tags/notes) tables.
 * Extends VFS tables with full tags and notes tables
 * needed for testing classic workspace functionality.
 */
export const classicTestMigrations = [
  {
    version: 1,
    up: async (adapter: DatabaseAdapter) => {
      // Core VFS tables
      await adapter.execute(`
        CREATE TABLE IF NOT EXISTS vfs_registry (
          id TEXT PRIMARY KEY,
          object_type TEXT NOT NULL,
          owner_id TEXT,
          encrypted_session_key TEXT,
          public_hierarchical_key TEXT,
          encrypted_private_hierarchical_key TEXT,
          encrypted_name TEXT,
          icon TEXT,
          view_mode TEXT,
          default_sort TEXT,
          sort_direction TEXT,
          created_at INTEGER NOT NULL
        )
      `);
      await adapter.execute(`
        CREATE TABLE IF NOT EXISTS vfs_links (
          id TEXT PRIMARY KEY,
          parent_id TEXT NOT NULL REFERENCES vfs_registry(id) ON DELETE CASCADE,
          child_id TEXT NOT NULL REFERENCES vfs_registry(id) ON DELETE CASCADE,
          wrapped_session_key TEXT NOT NULL,
          wrapped_hierarchical_key TEXT,
          visible_children TEXT,
          position INTEGER,
          created_at INTEGER NOT NULL
        )
      `);

      // Full tags table (extends vfs_registry)
      await adapter.execute(`
        CREATE TABLE IF NOT EXISTS tags (
          id TEXT PRIMARY KEY REFERENCES vfs_registry(id) ON DELETE CASCADE,
          encrypted_name TEXT,
          color TEXT,
          icon TEXT,
          deleted INTEGER NOT NULL DEFAULT 0
        )
      `);

      // Full notes table
      await adapter.execute(`
        CREATE TABLE IF NOT EXISTS notes (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          content TEXT NOT NULL DEFAULT '',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          deleted INTEGER NOT NULL DEFAULT 0
        )
      `);

      // Indexes for efficient queries
      await adapter.execute(`
        CREATE INDEX IF NOT EXISTS vfs_links_parent_idx ON vfs_links(parent_id)
      `);
      await adapter.execute(`
        CREATE INDEX IF NOT EXISTS vfs_links_child_idx ON vfs_links(child_id)
      `);
      await adapter.execute(`
        CREATE INDEX IF NOT EXISTS tags_deleted_idx ON tags(deleted)
      `);
      await adapter.execute(`
        CREATE INDEX IF NOT EXISTS notes_updated_at_idx ON notes(updated_at)
      `);

      await adapter.execute('PRAGMA foreign_keys = ON');
    }
  }
];

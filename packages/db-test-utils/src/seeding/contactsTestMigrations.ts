import type { DatabaseAdapter } from '../adapters/types.js';

/**
 * Test migrations for contacts tables.
 * Extends VFS tables with full contacts and contact_emails tables
 * needed for testing contact group email functionality.
 */
export const contactsTestMigrations = [
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

      // Contact groups table (extends vfs_registry)
      await adapter.execute(`
        CREATE TABLE IF NOT EXISTS contact_groups (
          id TEXT PRIMARY KEY REFERENCES vfs_registry(id) ON DELETE CASCADE,
          encrypted_name TEXT,
          color TEXT,
          icon TEXT
        )
      `);

      // Full contacts table
      await adapter.execute(`
        CREATE TABLE IF NOT EXISTS contacts (
          id TEXT PRIMARY KEY,
          first_name TEXT NOT NULL,
          last_name TEXT,
          birthday TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          deleted INTEGER NOT NULL DEFAULT 0
        )
      `);

      // Contact emails table (required for group email query)
      await adapter.execute(`
        CREATE TABLE IF NOT EXISTS contact_emails (
          id TEXT PRIMARY KEY,
          contact_id TEXT NOT NULL,
          email TEXT NOT NULL,
          label TEXT,
          is_primary INTEGER NOT NULL DEFAULT 0
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
        CREATE INDEX IF NOT EXISTS contact_emails_contact_idx ON contact_emails(contact_id)
      `);

      await adapter.execute('PRAGMA foreign_keys = ON');
    }
  }
];

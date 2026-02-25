import type { Migration } from '@tearleads/db-test-utils';

/**
 * Minimal schema for VFS trash integration tests.
 * Mirrors the VFS test migrations and includes canonical `vfs_item_state`
 * tombstones used by queryDeletedItems/useVfsTrashItems.
 */
export const trashTestMigrations: Migration[] = [
  {
    version: 1,
    up: async (adapter) => {
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
      await adapter.execute(`
        CREATE TABLE IF NOT EXISTS vfs_item_state (
          item_id TEXT PRIMARY KEY REFERENCES vfs_registry(id) ON DELETE CASCADE,
          encrypted_payload TEXT,
          key_epoch INTEGER,
          encryption_nonce TEXT,
          encryption_aad TEXT,
          encryption_signature TEXT,
          updated_at INTEGER NOT NULL,
          deleted_at INTEGER
        )
      `);
      await adapter.execute(`
        CREATE TABLE IF NOT EXISTS files (
          id TEXT PRIMARY KEY,
          name TEXT,
          deleted INTEGER NOT NULL DEFAULT 0
        )
      `);
      await adapter.execute(`
        CREATE TABLE IF NOT EXISTS contacts (
          id TEXT PRIMARY KEY,
          first_name TEXT,
          last_name TEXT,
          deleted INTEGER NOT NULL DEFAULT 0
        )
      `);
      await adapter.execute(`
        CREATE TABLE IF NOT EXISTS notes (
          id TEXT PRIMARY KEY,
          title TEXT,
          deleted INTEGER NOT NULL DEFAULT 0
        )
      `);
      await adapter.execute(`
        CREATE TABLE IF NOT EXISTS playlists (
          id TEXT PRIMARY KEY,
          encrypted_name TEXT
        )
      `);
      await adapter.execute(`
        CREATE TABLE IF NOT EXISTS albums (
          id TEXT PRIMARY KEY,
          encrypted_name TEXT
        )
      `);
      await adapter.execute(`
        CREATE TABLE IF NOT EXISTS contact_groups (
          id TEXT PRIMARY KEY,
          encrypted_name TEXT
        )
      `);
      await adapter.execute(`
        CREATE TABLE IF NOT EXISTS email_folders (
          id TEXT PRIMARY KEY REFERENCES vfs_registry(id) ON DELETE CASCADE,
          encrypted_name TEXT,
          folder_type TEXT,
          unread_count INTEGER NOT NULL DEFAULT 0,
          sync_uid_validity INTEGER,
          sync_last_uid INTEGER
        )
      `);
      await adapter.execute(`
        CREATE TABLE IF NOT EXISTS tags (
          id TEXT PRIMARY KEY,
          encrypted_name TEXT
        )
      `);
      await adapter.execute(`
        CREATE TABLE IF NOT EXISTS emails (
          id TEXT PRIMARY KEY,
          encrypted_subject TEXT
        )
      `);
      await adapter.execute('PRAGMA foreign_keys = ON');
    }
  }
];

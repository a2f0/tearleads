import type { DatabaseAdapter } from '../adapters/types.js';

/**
 * Test migrations for VFS tables.
 * These create a minimal VFS schema for testing purposes.
 *
 * Includes canonical vfs_item_state tombstones used by trash queries, plus
 * stub tables for queryFolderContents LEFT JOINs: files, contacts, notes,
 * playlists, albums, contactGroups, emailFolders, tags, emails.
 */
export const vfsTestMigrations = [
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

      // Stub tables for queryFolderContents LEFT JOINs
      // These are minimal versions just to satisfy the query structure
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
          first_name TEXT NOT NULL DEFAULT '',
          last_name TEXT,
          birthday TEXT,
          created_at INTEGER NOT NULL DEFAULT 0,
          updated_at INTEGER NOT NULL DEFAULT 0,
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
          encrypted_name TEXT,
          encrypted_description TEXT,
          cover_photo_id TEXT,
          album_type TEXT NOT NULL DEFAULT 'custom'
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
          id TEXT PRIMARY KEY,
          encrypted_name TEXT
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

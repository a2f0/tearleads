import type { Pool } from 'pg';
import type { Migration } from './types.js';

/**
 * v008: Add VFS (Virtual Filesystem) tables for encrypted sharing
 *
 * Creates:
 * - user_keys: User asymmetric keypairs for E2E encryption
 * - vfs_registry: Identity layer for all VFS items
 * - vfs_folders: Folder metadata (extends registry)
 * - vfs_links: Parent/child relationships with per-link key wrapping
 * - vfs_access: Direct access grants for sharing
 */
export const v008: Migration = {
  version: 8,
  description: 'Add VFS tables for encrypted sharing',
  up: async (pool: Pool) => {
    await pool.query('BEGIN');
    try {
      // User cryptographic keys for VFS encryption
      const createUserKeysTable = `CREATE TABLE IF NOT EXISTS "user_keys" (
        "user_id" TEXT PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
        "public_encryption_key" TEXT NOT NULL,
        "public_signing_key" TEXT NOT NULL,
        "encrypted_private_keys" TEXT NOT NULL,
        "argon2_salt" TEXT NOT NULL,
        "recovery_key_hash" TEXT,
        "created_at" TIMESTAMPTZ NOT NULL
      )`;

      // VFS registry - identity layer for all VFS items
      const createVfsRegistryTable = `CREATE TABLE IF NOT EXISTS "vfs_registry" (
        "id" TEXT PRIMARY KEY,
        "object_type" TEXT NOT NULL,
        "owner_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "encrypted_session_key" TEXT,
        "public_hierarchical_key" TEXT,
        "encrypted_private_hierarchical_key" TEXT,
        "created_at" TIMESTAMPTZ NOT NULL
      )`;
      const createVfsRegistryOwnerIndex =
        'CREATE INDEX IF NOT EXISTS "vfs_registry_owner_idx" ON "vfs_registry" ("owner_id")';
      const createVfsRegistryTypeIndex =
        'CREATE INDEX IF NOT EXISTS "vfs_registry_type_idx" ON "vfs_registry" ("object_type")';

      // VFS folders - extends registry for folder-type items
      const createVfsFoldersTable = `CREATE TABLE IF NOT EXISTS "vfs_folders" (
        "id" TEXT PRIMARY KEY REFERENCES "vfs_registry"("id") ON DELETE CASCADE,
        "encrypted_name" TEXT
      )`;

      // VFS links - parent/child relationships with key wrapping
      const createVfsLinksTable = `CREATE TABLE IF NOT EXISTS "vfs_links" (
        "id" TEXT PRIMARY KEY,
        "parent_id" TEXT NOT NULL REFERENCES "vfs_registry"("id") ON DELETE CASCADE,
        "child_id" TEXT NOT NULL REFERENCES "vfs_registry"("id") ON DELETE CASCADE,
        "wrapped_session_key" TEXT NOT NULL,
        "wrapped_hierarchical_key" TEXT,
        "visible_children" JSONB,
        "created_at" TIMESTAMPTZ NOT NULL
      )`;
      const createVfsLinksParentIndex =
        'CREATE INDEX IF NOT EXISTS "vfs_links_parent_idx" ON "vfs_links" ("parent_id")';
      const createVfsLinksChildIndex =
        'CREATE INDEX IF NOT EXISTS "vfs_links_child_idx" ON "vfs_links" ("child_id")';
      const createVfsLinksUniqueIndex =
        'CREATE UNIQUE INDEX IF NOT EXISTS "vfs_links_parent_child_idx" ON "vfs_links" ("parent_id", "child_id")';

      // VFS access - direct access grants for sharing
      const createVfsAccessTable = `CREATE TABLE IF NOT EXISTS "vfs_access" (
        "item_id" TEXT NOT NULL REFERENCES "vfs_registry"("id") ON DELETE CASCADE,
        "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "wrapped_session_key" TEXT NOT NULL,
        "wrapped_hierarchical_key" TEXT,
        "permission_level" TEXT NOT NULL CHECK ("permission_level" IN ('read', 'write', 'admin')),
        "granted_by" TEXT REFERENCES "users"("id") ON DELETE RESTRICT,
        "granted_at" TIMESTAMPTZ NOT NULL,
        "expires_at" TIMESTAMPTZ,
        PRIMARY KEY ("item_id", "user_id")
      )`;
      const createVfsAccessUserIndex =
        'CREATE INDEX IF NOT EXISTS "vfs_access_user_idx" ON "vfs_access" ("user_id")';
      const createVfsAccessItemIndex =
        'CREATE INDEX IF NOT EXISTS "vfs_access_item_idx" ON "vfs_access" ("item_id")';

      // Execute all statements
      await pool.query(createUserKeysTable);
      await pool.query(createVfsRegistryTable);
      await pool.query(createVfsRegistryOwnerIndex);
      await pool.query(createVfsRegistryTypeIndex);
      await pool.query(createVfsFoldersTable);
      await pool.query(createVfsLinksTable);
      await pool.query(createVfsLinksParentIndex);
      await pool.query(createVfsLinksChildIndex);
      await pool.query(createVfsLinksUniqueIndex);
      await pool.query(createVfsAccessTable);
      await pool.query(createVfsAccessUserIndex);
      await pool.query(createVfsAccessItemIndex);

      await pool.query('COMMIT');
    } catch (e) {
      await pool.query('ROLLBACK');
      throw e;
    }
  }
};

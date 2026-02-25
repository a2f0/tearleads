import type { Pool } from 'pg';
import type { Migration } from './types.js';

/**
 * v012: Add VFS Option B collection tables and metadata
 *
 * Adds:
 * - position column to vfs_links for ordered collections
 * - metadata columns to vfs_folders (icon, view_mode, etc.)
 * - playlists table for audio collections
 * - albums table for photo collections
 * - contact_groups table for contact organization
 * - tags table for cross-cutting organization
 * - emails table for email messages
 */
export const v012: Migration = {
  version: 12,
  description: 'Add VFS Option B collection tables',
  up: async (pool: Pool) => {
    await pool.query('BEGIN');
    try {
      // Add position column to vfs_links for ordered collections
      await pool.query(`
        ALTER TABLE "vfs_links"
        ADD COLUMN IF NOT EXISTS "position" INTEGER
      `);

      // Add metadata columns to vfs_folders
      await pool.query(`
        ALTER TABLE "vfs_folders"
        ADD COLUMN IF NOT EXISTS "icon" TEXT,
        ADD COLUMN IF NOT EXISTS "view_mode" TEXT,
        ADD COLUMN IF NOT EXISTS "default_sort" TEXT,
        ADD COLUMN IF NOT EXISTS "sort_direction" TEXT
      `);

      // Create playlists table
      await pool.query(`
        CREATE TABLE IF NOT EXISTS "playlists" (
          "id" TEXT PRIMARY KEY REFERENCES "vfs_registry"("id") ON DELETE CASCADE,
          "encrypted_name" TEXT,
          "encrypted_description" TEXT,
          "cover_image_id" TEXT REFERENCES "vfs_registry"("id") ON DELETE SET NULL,
          "shuffle_mode" INTEGER NOT NULL DEFAULT 0
        )
      `);

      // Create albums table
      await pool.query(`
        CREATE TABLE IF NOT EXISTS "albums" (
          "id" TEXT PRIMARY KEY REFERENCES "vfs_registry"("id") ON DELETE CASCADE,
          "encrypted_name" TEXT,
          "encrypted_description" TEXT,
          "cover_photo_id" TEXT REFERENCES "vfs_registry"("id") ON DELETE SET NULL
        )
      `);

      // Create contact_groups table
      await pool.query(`
        CREATE TABLE IF NOT EXISTS "contact_groups" (
          "id" TEXT PRIMARY KEY REFERENCES "vfs_registry"("id") ON DELETE CASCADE,
          "encrypted_name" TEXT,
          "color" TEXT,
          "icon" TEXT
        )
      `);

      // Create tags table
      await pool.query(`
        CREATE TABLE IF NOT EXISTS "tags" (
          "id" TEXT PRIMARY KEY REFERENCES "vfs_registry"("id") ON DELETE CASCADE,
          "encrypted_name" TEXT,
          "color" TEXT,
          "icon" TEXT
        )
      `);

      // Create emails table
      await pool.query(`
        CREATE TABLE IF NOT EXISTS "emails" (
          "id" TEXT PRIMARY KEY REFERENCES "vfs_registry"("id") ON DELETE CASCADE,
          "encrypted_subject" TEXT,
          "encrypted_from" TEXT,
          "encrypted_to" JSONB,
          "encrypted_cc" JSONB,
          "encrypted_body_path" TEXT,
          "ciphertext_size" INTEGER NOT NULL DEFAULT 0,
          "received_at" TIMESTAMPTZ NOT NULL,
          "is_read" BOOLEAN NOT NULL DEFAULT false,
          "is_starred" BOOLEAN NOT NULL DEFAULT false
        )
      `);

      // Create index for emails received_at
      await pool.query(`
        CREATE INDEX IF NOT EXISTS "emails_received_at_idx" ON "emails" ("received_at")
      `);

      await pool.query('COMMIT');
    } catch (e) {
      await pool.query('ROLLBACK');
      throw e;
    }
  }
};

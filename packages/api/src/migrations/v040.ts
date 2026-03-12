import type { Pool } from 'pg';
import type { Migration } from './types.js';

/**
 * v040: Migrate VFS ID columns from TEXT to UUID.
 *
 * This migration converts core identity and VFS tables to use the UUID type
 * for better storage efficiency and index performance.
 */
export const v040: Migration = {
  version: 40,
  description: 'Migrate VFS IDs to UUID',
  up: async (pool: Pool) => {
    // We need to drop views that depend on these columns first
    await pool.query('DROP VIEW IF EXISTS "vfs_effective_visibility"');

    // Users table
    await pool.query(`
      ALTER TABLE "users" ALTER COLUMN "id" TYPE UUID USING id::uuid;
      ALTER TABLE "user_credentials" ALTER COLUMN "user_id" TYPE UUID USING user_id::uuid;
      ALTER TABLE "user_groups" ALTER COLUMN "user_id" TYPE UUID USING user_id::uuid;
      ALTER TABLE "user_organizations" ALTER COLUMN "user_id" TYPE UUID USING user_id::uuid;
    `);

    // VFS Registry and related
    await pool.query(`
      ALTER TABLE "vfs_registry" ALTER COLUMN "id" TYPE UUID USING id::uuid;
      ALTER TABLE "vfs_registry" ALTER COLUMN "owner_id" TYPE UUID USING owner_id::uuid;
      ALTER TABLE "vfs_links" ALTER COLUMN "parent_id" TYPE UUID USING parent_id::uuid;
      ALTER TABLE "vfs_links" ALTER COLUMN "child_id" TYPE UUID USING child_id::uuid;
      ALTER TABLE "vfs_acl_entries" ALTER COLUMN "item_id" TYPE UUID USING item_id::uuid;
      -- principal_id is polymorphic (can be group/org/user), all are UUIDs
      ALTER TABLE "vfs_acl_entries" ALTER COLUMN "principal_id" TYPE UUID USING principal_id::uuid;
      ALTER TABLE "vfs_acl_entries" ALTER COLUMN "granted_by" TYPE UUID USING granted_by::uuid;
    `);

    // Sync and CRDT tables
    await pool.query(`
      ALTER TABLE "vfs_sync_changes" ALTER COLUMN "item_id" TYPE UUID USING item_id::uuid;
      ALTER TABLE "vfs_sync_changes" ALTER COLUMN "root_id" TYPE UUID USING root_id::uuid;
      
      ALTER TABLE "vfs_crdt_ops" ALTER COLUMN "item_id" TYPE UUID USING item_id::uuid;
      ALTER TABLE "vfs_crdt_ops" ALTER COLUMN "parent_id" TYPE UUID USING parent_id::uuid;
      ALTER TABLE "vfs_crdt_ops" ALTER COLUMN "child_id" TYPE UUID USING child_id::uuid;
      ALTER TABLE "vfs_crdt_ops" ALTER COLUMN "actor_id" TYPE UUID USING actor_id::uuid;
      ALTER TABLE "vfs_crdt_ops" ALTER COLUMN "source_id" TYPE UUID USING source_id::uuid;
      ALTER TABLE "vfs_crdt_ops" ALTER COLUMN "root_id" TYPE UUID USING root_id::uuid;

      ALTER TABLE "vfs_crdt_snapshots" ALTER COLUMN "user_id" TYPE UUID USING user_id::uuid;
      ALTER TABLE "vfs_sync_client_state" ALTER COLUMN "user_id" TYPE UUID USING user_id::uuid;
      -- client_id often has 'crdt:' prefix, keep as text
    `);

    // Visibility Materialized Table
    await pool.query(`
      ALTER TABLE "vfs_effective_visibility_mat" ALTER COLUMN "user_id" TYPE UUID USING user_id::uuid;
      ALTER TABLE "vfs_effective_visibility_mat" ALTER COLUMN "item_id" TYPE UUID USING item_id::uuid;
    `);

    // Recreate the view
    await pool.query(`
      CREATE OR REPLACE VIEW "vfs_effective_visibility" AS
      SELECT user_id, item_id, access_rank FROM "vfs_effective_visibility_mat";
    `);
  }
};

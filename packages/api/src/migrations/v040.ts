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

    // Redefine visibility refresh functions to use UUID parameters
    await pool.query(`
      CREATE OR REPLACE FUNCTION "vfs_refresh_visibility_for_item"(target_item_id UUID)
      RETURNS VOID AS $$
      BEGIN
        DELETE FROM "vfs_effective_visibility_mat" WHERE item_id = target_item_id;

        INSERT INTO "vfs_effective_visibility_mat" (user_id, item_id, access_rank)
        WITH principal_users AS (
          SELECT
            'user'::text AS principal_type,
            users.id AS principal_id,
            users.id AS user_id
          FROM users
          UNION ALL
          SELECT
            'group'::text AS principal_type,
            user_groups.group_id AS principal_id,
            user_groups.user_id AS user_id
          FROM user_groups
          UNION ALL
          SELECT
            'organization'::text AS principal_type,
            user_organizations.organization_id AS principal_id,
            user_organizations.user_id AS user_id
          FROM user_organizations
        ),
        owner_access AS (
          SELECT
            registry.owner_id AS user_id,
            registry.id AS item_id,
            3::integer AS access_rank
          FROM vfs_registry registry
          WHERE registry.id = target_item_id
            AND registry.owner_id IS NOT NULL
        ),
        acl_access AS (
          SELECT
            principal.user_id,
            entry.item_id,
            MAX(
              CASE entry.access_level
                WHEN 'admin' THEN 3
                WHEN 'write' THEN 2
                ELSE 1
              END
            )::integer AS access_rank
          FROM vfs_acl_entries entry
          INNER JOIN principal_users principal
            ON principal.principal_type = entry.principal_type
           AND principal.principal_id = entry.principal_id
          WHERE entry.item_id = target_item_id
            AND entry.revoked_at IS NULL
            AND (entry.expires_at IS NULL OR entry.expires_at > NOW())
          GROUP BY principal.user_id, entry.item_id
        ),
        combined_access AS (
          SELECT user_id, item_id, access_rank FROM owner_access
          UNION ALL
          SELECT user_id, item_id, access_rank FROM acl_access
        )
        SELECT
          combined.user_id,
          combined.item_id,
          MAX(combined.access_rank)::integer AS access_rank
        FROM combined_access combined
        GROUP BY combined.user_id, combined.item_id
        ON CONFLICT (user_id, item_id) DO UPDATE
        SET access_rank = EXCLUDED.access_rank;
      END;
      $$ LANGUAGE plpgsql;

      CREATE OR REPLACE FUNCTION "vfs_refresh_visibility_for_user"(target_user_id UUID)
      RETURNS VOID AS $$
      BEGIN
        DELETE FROM "vfs_effective_visibility_mat" WHERE user_id = target_user_id;

        INSERT INTO "vfs_effective_visibility_mat" (user_id, item_id, access_rank)
        WITH principal_ids AS (
          SELECT 'user'::text AS principal_type, target_user_id AS principal_id
          UNION ALL
          SELECT 'group'::text AS principal_type, group_id AS principal_id
          FROM user_groups
          WHERE user_id = target_user_id
          UNION ALL
          SELECT 'organization'::text AS principal_type, organization_id AS principal_id
          FROM user_organizations
          WHERE user_id = target_user_id
        ),
        owner_access AS (
          SELECT
            registry.owner_id AS user_id,
            registry.id AS item_id,
            3::integer AS access_rank
          FROM vfs_registry registry
          WHERE registry.owner_id = target_user_id
        ),
        acl_access AS (
          SELECT
            target_user_id AS user_id,
            entry.item_id,
            MAX(
              CASE entry.access_level
                WHEN 'admin' THEN 3
                WHEN 'write' THEN 2
                ELSE 1
              END
            )::integer AS access_rank
          FROM vfs_acl_entries entry
          INNER JOIN principal_ids p
            ON p.principal_type = entry.principal_type
           AND p.principal_id = entry.principal_id
          WHERE entry.revoked_at IS NULL
            AND (entry.expires_at IS NULL OR entry.expires_at > NOW())
          GROUP BY entry.item_id
        ),
        combined_access AS (
          SELECT user_id, item_id, access_rank FROM owner_access
          UNION ALL
          SELECT user_id, item_id, access_rank FROM acl_access
        )
        SELECT
          combined.user_id,
          combined.item_id,
          MAX(combined.access_rank)::integer AS access_rank
        FROM combined_access combined
        GROUP BY combined.user_id, combined.item_id
        ON CONFLICT (user_id, item_id) DO UPDATE
        SET access_rank = EXCLUDED.access_rank;
      END;
      $$ LANGUAGE plpgsql;
    `);

    // Recreate the view
    await pool.query(`
      CREATE OR REPLACE VIEW "vfs_effective_visibility" AS
      SELECT user_id, item_id, access_rank FROM "vfs_effective_visibility_mat";
    `);
  }
};

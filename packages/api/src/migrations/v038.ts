import type { Pool } from 'pg';
import type { Migration } from './types.js';

/**
 * v038: Materialize VFS effective visibility for optimized sync feeds.
 *
 * This migration:
 * 1. Creates vfs_effective_visibility_mat as a table.
 * 2. Adds indexes for fast lookups by user and item.
 * 3. Implements triggers to keep the materialized state in sync.
 */
export const v038: Migration = {
  version: 38,
  description: 'Materialize VFS effective visibility',
  up: async (pool: Pool) => {
    // 1. Create the table
    await pool.query(`
      CREATE TABLE "vfs_effective_visibility_mat" (
        user_id UUID NOT NULL,
        item_id UUID NOT NULL,
        access_rank INTEGER NOT NULL,
        PRIMARY KEY (user_id, item_id)
      );

      CREATE INDEX "idx_vfs_visibility_user_item" ON "vfs_effective_visibility_mat" (user_id, item_id);
      CREATE INDEX "idx_vfs_visibility_item" ON "vfs_effective_visibility_mat" (item_id);
    `);

    // 2. Define the refresh function logic
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
    `);

    // 3. Define refresh for user (for group/org membership changes)
    await pool.query(`
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

    // 4. Create triggers
    await pool.query(`
      CREATE OR REPLACE FUNCTION "tg_vfs_refresh_item_visibility"()
      RETURNS TRIGGER AS $$
      BEGIN
        IF (TG_OP = 'DELETE') THEN
          PERFORM "vfs_refresh_visibility_for_item"(OLD.item_id);
          -- If item was in registry and deleted, also cleanup
          IF TG_TABLE_NAME = 'vfs_registry' THEN
            DELETE FROM "vfs_effective_visibility_mat" WHERE item_id = OLD.id;
          END IF;
        ELSIF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') THEN
          IF TG_TABLE_NAME = 'vfs_registry' THEN
            PERFORM "vfs_refresh_visibility_for_item"(NEW.id);
          ELSE
            PERFORM "vfs_refresh_visibility_for_item"(NEW.item_id);
          END IF;
        END IF;
        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql;

      CREATE TRIGGER "tg_refresh_visibility_registry"
      AFTER INSERT OR UPDATE OR DELETE ON "vfs_registry"
      FOR EACH ROW EXECUTE FUNCTION "tg_vfs_refresh_item_visibility"();

      CREATE TRIGGER "tg_refresh_visibility_acl"
      AFTER INSERT OR UPDATE OR DELETE ON "vfs_acl_entries"
      FOR EACH ROW EXECUTE FUNCTION "tg_vfs_refresh_item_visibility"();

      CREATE OR REPLACE FUNCTION "tg_vfs_refresh_user_visibility"()
      RETURNS TRIGGER AS $$
      BEGIN
        IF (TG_OP = 'DELETE') THEN
          PERFORM "vfs_refresh_visibility_for_user"(OLD.user_id);
        ELSE
          PERFORM "vfs_refresh_visibility_for_user"(NEW.user_id);
        END IF;
        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql;

      CREATE TRIGGER "tg_refresh_visibility_groups"
      AFTER INSERT OR UPDATE OR DELETE ON "user_groups"
      FOR EACH ROW EXECUTE FUNCTION "tg_vfs_refresh_user_visibility"();

      CREATE TRIGGER "tg_refresh_visibility_orgs"
      AFTER INSERT OR UPDATE OR DELETE ON "user_organizations"
      FOR EACH ROW EXECUTE FUNCTION "tg_vfs_refresh_user_visibility"();
    `);

    // 5. Initial population
    await pool.query(`
      INSERT INTO "vfs_effective_visibility_mat" (user_id, item_id, access_rank)
      SELECT user_id, item_id, access_rank FROM "vfs_effective_visibility"
      ON CONFLICT DO NOTHING;
    `);

    // 6. Update the view to point to the materialized table
    await pool.query(`
      CREATE OR REPLACE VIEW "vfs_effective_visibility" AS
      SELECT user_id, item_id, access_rank FROM "vfs_effective_visibility_mat";
    `);
  }
};

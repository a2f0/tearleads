import type { Pool } from 'pg';
import type { Migration } from './types.js';

/**
 * v030: Add canonical effective visibility relation for sync feeds.
 *
 * Sync and rematerialization SQL reads from vfs_effective_visibility.
 * This migration defines it as a view derived from canonical ownership +
 * ACL state so greenfield environments have the required relation.
 */
export const v030: Migration = {
  version: 30,
  description: 'Add canonical vfs effective visibility view',
  up: async (pool: Pool) => {
    await pool.query(`
      CREATE OR REPLACE VIEW "vfs_effective_visibility" AS
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
        WHERE registry.owner_id IS NOT NULL
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
        WHERE entry.revoked_at IS NULL
          AND (entry.expires_at IS NULL OR entry.expires_at > NOW())
        GROUP BY principal.user_id, entry.item_id
      ),
      combined_access AS (
        SELECT user_id, item_id, access_rank
        FROM owner_access
        UNION ALL
        SELECT user_id, item_id, access_rank
        FROM acl_access
      )
      SELECT
        combined.user_id,
        combined.item_id,
        MAX(combined.access_rank)::integer AS access_rank
      FROM combined_access combined
      GROUP BY combined.user_id, combined.item_id
    `);
  }
};

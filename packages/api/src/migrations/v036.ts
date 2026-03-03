import type { Pool } from 'pg';
import type { Migration } from './types.js';

/**
 * v036: Require organization_id on vfs_registry.
 *
 * Backfills existing rows from known ownership sources, then enforces NOT NULL.
 */
export const v036: Migration = {
  version: 36,
  description: 'Require organization_id on vfs_registry',
  up: async (pool: Pool) => {
    await pool.query('BEGIN');
    try {
      await pool.query(`
        ALTER TABLE "vfs_registry"
        ADD COLUMN IF NOT EXISTS "organization_id" TEXT
      `);

      await pool.query(`
        UPDATE "vfs_registry" AS registry
        SET "organization_id" = users.personal_organization_id
        FROM "users" AS users
        WHERE registry."owner_id" = users."id"
          AND registry."organization_id" IS NULL
          AND users."personal_organization_id" IS NOT NULL
      `);

      await pool.query(`
        UPDATE "vfs_registry" AS registry
        SET "organization_id" = groups."organization_id"
        FROM "mls_messages" AS messages
        INNER JOIN "mls_groups" AS groups
                ON groups."id" = messages."group_id"
        WHERE registry."id" = messages."id"
          AND registry."organization_id" IS NULL
      `);

      await pool.query(`
        UPDATE "vfs_registry" AS registry
        SET "organization_id" = organization_acl.organization_id
        FROM (
          SELECT item_id, MIN(principal_id) AS organization_id
          FROM vfs_acl_entries
          WHERE principal_type = 'organization'
            AND revoked_at IS NULL
          GROUP BY item_id
        ) AS organization_acl
        WHERE registry.id = organization_acl.item_id
          AND registry.organization_id IS NULL
      `);

      const remainingUnscopedResult = await pool.query<{ count: string }>(`
        SELECT COUNT(*)::text AS count
        FROM "vfs_registry"
        WHERE "organization_id" IS NULL
      `);
      const remainingUnscopedCount = Number.parseInt(
        remainingUnscopedResult.rows[0]?.count ?? '0',
        10
      );

      if (remainingUnscopedCount > 0) {
        throw new Error(
          `Unable to backfill organization_id for ${remainingUnscopedCount} vfs_registry rows`
        );
      }

      await pool.query(`
        ALTER TABLE "vfs_registry"
        ALTER COLUMN "organization_id" SET NOT NULL
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS "vfs_registry_org_idx"
        ON "vfs_registry" ("organization_id")
      `);

      await pool.query('COMMIT');
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  }
};

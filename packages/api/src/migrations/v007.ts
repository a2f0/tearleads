import type { Pool } from 'pg';
import type { Migration } from './types.js';

/**
 * v007: Add organizations and user_organizations; add org to groups
 *
 * Creates:
 * - organizations: org records for grouping users and groups
 * - user_organizations: junction table for user memberships
 * Updates:
 * - groups: add organization_id, move unique constraint to (organization_id, name)
 */
export const v007: Migration = {
  version: 7,
  description: 'Add organizations and org membership',
  up: async (pool: Pool) => {
    await pool.query('BEGIN');
    try {
      const createOrganizationsTable = `CREATE TABLE IF NOT EXISTS "organizations" (
        "id" TEXT PRIMARY KEY,
        "name" TEXT NOT NULL,
        "description" TEXT,
        "created_at" TIMESTAMPTZ NOT NULL,
        "updated_at" TIMESTAMPTZ NOT NULL
      )`;
      const createOrganizationsNameIndex =
        'CREATE UNIQUE INDEX IF NOT EXISTS "organizations_name_idx" ON "organizations" ("name")';
      const createUserOrganizationsTable = `CREATE TABLE IF NOT EXISTS "user_organizations" (
        "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "organization_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
        "joined_at" TIMESTAMPTZ NOT NULL,
        PRIMARY KEY ("user_id", "organization_id")
      )`;
      const createUserOrganizationsIndex =
        'CREATE INDEX IF NOT EXISTS "user_organizations_org_idx" ON "user_organizations" ("organization_id")';

      await pool.query(createOrganizationsTable);
      await pool.query(createOrganizationsNameIndex);
      await pool.query(createUserOrganizationsTable);
      await pool.query(createUserOrganizationsIndex);

      await pool.query(
        'ALTER TABLE "groups" ADD COLUMN IF NOT EXISTS "organization_id" TEXT'
      );

      await pool.query(
        'ALTER TABLE "groups" ALTER COLUMN "organization_id" SET NOT NULL'
      );
      await pool.query(
        `ALTER TABLE "groups"
         ADD CONSTRAINT "groups_organization_id_fkey"
         FOREIGN KEY ("organization_id")
         REFERENCES "organizations"("id")
         ON DELETE CASCADE`
      );

      await pool.query('DROP INDEX IF EXISTS "groups_name_idx"');
      await pool.query(
        'CREATE UNIQUE INDEX IF NOT EXISTS "groups_org_name_idx" ON "groups" ("organization_id", "name")'
      );
      await pool.query(
        'CREATE INDEX IF NOT EXISTS "groups_org_idx" ON "groups" ("organization_id")'
      );
      await pool.query('COMMIT');
    } catch (e) {
      await pool.query('ROLLBACK');
      throw e;
    }
  }
};

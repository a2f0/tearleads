import type { Pool } from 'pg';
import type { Migration } from './types.js';

/**
 * v020: Scope MLS groups to organizations and enforce org-local membership
 *
 * Changes:
 * - mls_groups.organization_id (required, FK to organizations)
 * - mls_key_packages.consumed_by_group_id FK to mls_groups(id)
 * - Trigger guard to require mls_group_members users to belong to group org
 */
export const v020: Migration = {
  version: 20,
  description: 'Scope MLS data to organizations and enforce membership bounds',
  up: async (pool: Pool) => {
    await pool.query('BEGIN');
    try {
      await pool.query(`
        ALTER TABLE "mls_groups"
        ADD COLUMN IF NOT EXISTS "organization_id" TEXT
      `);

      await pool.query(`
        UPDATE mls_groups g
           SET organization_id = u.personal_organization_id
          FROM users u
         WHERE g.creator_user_id = u.id
           AND g.organization_id IS NULL
      `);

      await pool.query(`
        UPDATE mls_groups g
           SET organization_id = fallback.organization_id
          FROM (
            SELECT DISTINCT ON (uo.user_id) uo.user_id, uo.organization_id
              FROM user_organizations uo
             ORDER BY uo.user_id, uo.organization_id
          ) fallback
         WHERE g.creator_user_id = fallback.user_id
           AND g.organization_id IS NULL
      `);

      const unscopedGroups = await pool.query<{ count: string }>(`
        SELECT COUNT(*)::text AS count
          FROM mls_groups
         WHERE organization_id IS NULL
      `);

      const remainingUnscopedCount = Number.parseInt(
        unscopedGroups.rows[0]?.count ?? '0',
        10
      );
      if (remainingUnscopedCount > 0) {
        throw new Error(
          `Unable to backfill organization_id for ${remainingUnscopedCount} MLS groups`
        );
      }

      await pool.query(`
        DO $$
        BEGIN
          ALTER TABLE "mls_groups"
          ADD CONSTRAINT "mls_groups_organization_id_fkey"
          FOREIGN KEY ("organization_id")
          REFERENCES "organizations"("id")
          ON DELETE CASCADE;
        EXCEPTION
          WHEN duplicate_object THEN NULL;
        END $$;
      `);

      await pool.query(`
        ALTER TABLE "mls_groups"
        ALTER COLUMN "organization_id" SET NOT NULL
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS "mls_groups_org_idx"
        ON "mls_groups" ("organization_id")
      `);

      await pool.query(`
        UPDATE mls_key_packages kp
           SET consumed_by_group_id = NULL
         WHERE consumed_by_group_id IS NOT NULL
           AND NOT EXISTS (
             SELECT 1
               FROM mls_groups g
              WHERE g.id = kp.consumed_by_group_id
           )
      `);

      await pool.query(`
        DO $$
        BEGIN
          ALTER TABLE "mls_key_packages"
          ADD CONSTRAINT "mls_key_packages_consumed_by_group_id_fkey"
          FOREIGN KEY ("consumed_by_group_id")
          REFERENCES "mls_groups"("id")
          ON DELETE SET NULL;
        EXCEPTION
          WHEN duplicate_object THEN NULL;
        END $$;
      `);

      await pool.query(`
        CREATE OR REPLACE FUNCTION enforce_mls_group_member_org_boundary()
        RETURNS TRIGGER AS $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1
              FROM mls_groups g
              INNER JOIN user_organizations uo
                      ON uo.organization_id = g.organization_id
                     AND uo.user_id = NEW.user_id
             WHERE g.id = NEW.group_id
          ) THEN
            RAISE EXCEPTION 'MLS member must belong to group organization';
          END IF;

          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
      `);

      await pool.query(`
        DROP TRIGGER IF EXISTS "mls_group_members_org_boundary_trigger"
        ON "mls_group_members"
      `);

      await pool.query(`
        CREATE TRIGGER "mls_group_members_org_boundary_trigger"
        BEFORE INSERT OR UPDATE OF group_id, user_id
        ON "mls_group_members"
        FOR EACH ROW
        EXECUTE FUNCTION enforce_mls_group_member_org_boundary()
      `);

      await pool.query('COMMIT');
    } catch (e) {
      await pool.query('ROLLBACK');
      throw e;
    }
  }
};

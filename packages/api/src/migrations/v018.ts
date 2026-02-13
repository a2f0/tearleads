import type { Pool } from 'pg';
import type { Migration } from './types.js';

/**
 * v018: Enforce personal organization linkage for every user
 *
 * Adds:
 * - organizations.is_personal
 * - users.personal_organization_id (required, unique, FK to organizations)
 *
 * Backfills existing users with a generated personal organization and
 * ensures each user is an admin member of their personal organization.
 */
export const v018: Migration = {
  version: 18,
  description: 'Add required personal organization linkage for users',
  up: async (pool: Pool) => {
    await pool.query('BEGIN');
    try {
      await pool.query(`
        ALTER TABLE "organizations"
        ADD COLUMN IF NOT EXISTS "is_personal" BOOLEAN NOT NULL DEFAULT FALSE
      `);

      await pool.query(`
        ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "personal_organization_id" TEXT
      `);

      await pool.query(`
        INSERT INTO organizations (id, name, description, is_personal, created_at, updated_at)
        SELECT
          'personal-org-' || u.id,
          'Personal ' || u.id,
          'Personal organization for ' || u.email,
          TRUE,
          COALESCE(u.created_at, NOW()),
          NOW()
        FROM users u
        WHERE u.personal_organization_id IS NULL
          AND NOT EXISTS (
            SELECT 1
            FROM organizations o
            WHERE o.id = 'personal-org-' || u.id
          )
      `);

      await pool.query(`
        UPDATE users
        SET personal_organization_id = 'personal-org-' || id
        WHERE personal_organization_id IS NULL
      `);

      await pool.query(`
        UPDATE organizations o
        SET is_personal = TRUE,
            updated_at = NOW()
        FROM users u
        WHERE u.personal_organization_id = o.id
      `);

      await pool.query(`
        INSERT INTO user_organizations (user_id, organization_id, joined_at, is_admin)
        SELECT u.id, u.personal_organization_id, NOW(), TRUE
        FROM users u
        WHERE u.personal_organization_id IS NOT NULL
        ON CONFLICT (user_id, organization_id)
        DO UPDATE SET is_admin = TRUE
      `);

      await pool.query(`
        DO $$
        BEGIN
          ALTER TABLE "users"
          ADD CONSTRAINT "users_personal_organization_id_fkey"
          FOREIGN KEY ("personal_organization_id")
          REFERENCES "organizations"("id")
          ON DELETE RESTRICT
          DEFERRABLE INITIALLY DEFERRED;
        EXCEPTION
          WHEN duplicate_object THEN NULL;
        END $$;
      `);

      await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS "users_personal_organization_id_idx"
        ON "users" ("personal_organization_id")
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS "organizations_is_personal_idx"
        ON "organizations" ("is_personal")
        WHERE "is_personal" = TRUE
      `);

      await pool.query(`
        ALTER TABLE "users"
        ALTER COLUMN "personal_organization_id" SET NOT NULL
      `);

      await pool.query('COMMIT');
    } catch (e) {
      await pool.query('ROLLBACK');
      throw e;
    }
  }
};

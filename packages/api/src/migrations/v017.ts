import type { Pool } from 'pg';
import type { Migration } from './types.js';

/**
 * v017: Add account disable and deletion marking fields to users table
 *
 * Adds:
 * - disabled: Boolean flag to disable account (block login)
 * - disabled_at: Timestamp when account was disabled
 * - disabled_by: User ID of admin who disabled the account (FK to users)
 * - marked_for_deletion_at: Timestamp when account was marked for deletion
 * - marked_for_deletion_by: User ID of admin who marked for deletion (FK to users)
 *
 * COMPLIANCE_SENTINEL: TL-ACCT-002 | policy=compliance/SOC2/policies/account-management-policy.md | procedure=compliance/SOC2/procedures/account-management-procedure.md | control=account-disable-attribution
 * COMPLIANCE_SENTINEL: TL-ACCT-003 | policy=compliance/SOC2/policies/account-management-policy.md | procedure=compliance/SOC2/procedures/account-management-procedure.md | control=deletion-marking-attribution
 */
export const v017: Migration = {
  version: 17,
  description: 'Add account disable and deletion marking fields to users table',
  up: async (pool: Pool) => {
    await pool.query('BEGIN');
    try {
      await pool.query(`
        ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "disabled" BOOLEAN NOT NULL DEFAULT FALSE
      `);

      await pool.query(`
        ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "disabled_at" TIMESTAMPTZ
      `);

      await pool.query(`
        ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "disabled_by" TEXT REFERENCES users(id)
      `);

      await pool.query(`
        ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "marked_for_deletion_at" TIMESTAMPTZ
      `);

      await pool.query(`
        ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "marked_for_deletion_by" TEXT REFERENCES users(id)
      `);

      await pool.query('COMMIT');
    } catch (e) {
      await pool.query('ROLLBACK');
      throw e;
    }
  }
};

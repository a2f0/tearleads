import type { Pool } from 'pg';
import type { Migration } from './types.js';

/**
 * v028: Add container share policy + ACL provenance schema
 *
 * Introduces policy header/selectors/principals tables and ACL provenance
 * metadata required by the policy compiler rollout.
 */
export const v028: Migration = {
  version: 28,
  description: 'Add container share policy and ACL provenance schema',
  up: async (pool: Pool) => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "vfs_share_policies" (
        "id" TEXT PRIMARY KEY,
        "root_item_id" TEXT NOT NULL REFERENCES "vfs_registry"("id") ON DELETE CASCADE,
        "status" TEXT NOT NULL CHECK ("status" IN ('draft', 'active', 'paused', 'revoked')) DEFAULT 'draft',
        "name" TEXT,
        "created_by" TEXT REFERENCES "users"("id") ON DELETE SET NULL,
        "schema_version" INTEGER NOT NULL DEFAULT 1,
        "created_at" TIMESTAMPTZ NOT NULL,
        "updated_at" TIMESTAMPTZ NOT NULL,
        "expires_at" TIMESTAMPTZ,
        "revoked_at" TIMESTAMPTZ
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS "vfs_share_policies_root_idx"
      ON "vfs_share_policies" ("root_item_id")
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS "vfs_share_policies_status_idx"
      ON "vfs_share_policies" ("status")
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS "vfs_share_policies_created_by_idx"
      ON "vfs_share_policies" ("created_by")
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS "vfs_share_policy_selectors" (
        "id" TEXT PRIMARY KEY,
        "policy_id" TEXT NOT NULL REFERENCES "vfs_share_policies"("id") ON DELETE CASCADE,
        "selector_kind" TEXT NOT NULL CHECK ("selector_kind" IN ('include', 'exclude')),
        "match_mode" TEXT NOT NULL CHECK ("match_mode" IN ('subtree', 'children', 'exact')) DEFAULT 'subtree',
        "anchor_item_id" TEXT REFERENCES "vfs_registry"("id") ON DELETE SET NULL,
        "max_depth" INTEGER,
        "include_root" BOOLEAN NOT NULL DEFAULT TRUE,
        "object_types" JSONB,
        "selector_order" INTEGER NOT NULL DEFAULT 0,
        "created_at" TIMESTAMPTZ NOT NULL,
        "updated_at" TIMESTAMPTZ NOT NULL
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS "vfs_share_policy_selectors_policy_idx"
      ON "vfs_share_policy_selectors" ("policy_id")
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS "vfs_share_policy_selectors_anchor_idx"
      ON "vfs_share_policy_selectors" ("anchor_item_id")
    `);
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "vfs_share_policy_selectors_policy_order_idx"
      ON "vfs_share_policy_selectors" ("policy_id", "selector_order")
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS "vfs_share_policy_principals" (
        "id" TEXT PRIMARY KEY,
        "policy_id" TEXT NOT NULL REFERENCES "vfs_share_policies"("id") ON DELETE CASCADE,
        "principal_type" TEXT NOT NULL CHECK ("principal_type" IN ('user', 'group', 'organization')),
        "principal_id" TEXT NOT NULL,
        "access_level" TEXT NOT NULL CHECK ("access_level" IN ('read', 'write', 'admin')),
        "created_at" TIMESTAMPTZ NOT NULL,
        "updated_at" TIMESTAMPTZ NOT NULL
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS "vfs_share_policy_principals_policy_idx"
      ON "vfs_share_policy_principals" ("policy_id")
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS "vfs_share_policy_principals_target_idx"
      ON "vfs_share_policy_principals" ("principal_type", "principal_id")
    `);
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "vfs_share_policy_principals_unique_idx"
      ON "vfs_share_policy_principals" ("policy_id", "principal_type", "principal_id")
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS "vfs_acl_entry_provenance" (
        "id" TEXT PRIMARY KEY,
        "acl_entry_id" TEXT NOT NULL REFERENCES "vfs_acl_entries"("id") ON DELETE CASCADE,
        "provenance_type" TEXT NOT NULL CHECK ("provenance_type" IN ('direct', 'derivedPolicy')),
        "policy_id" TEXT REFERENCES "vfs_share_policies"("id") ON DELETE SET NULL,
        "selector_id" TEXT REFERENCES "vfs_share_policy_selectors"("id") ON DELETE SET NULL,
        "decision" TEXT NOT NULL CHECK ("decision" IN ('allow', 'deny')) DEFAULT 'allow',
        "precedence" INTEGER NOT NULL DEFAULT 0,
        "compiled_at" TIMESTAMPTZ,
        "compiler_run_id" TEXT,
        "created_at" TIMESTAMPTZ NOT NULL,
        "updated_at" TIMESTAMPTZ NOT NULL
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS "vfs_acl_entry_provenance_acl_entry_idx"
      ON "vfs_acl_entry_provenance" ("acl_entry_id")
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS "vfs_acl_entry_provenance_policy_idx"
      ON "vfs_acl_entry_provenance" ("policy_id")
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS "vfs_acl_entry_provenance_selector_idx"
      ON "vfs_acl_entry_provenance" ("selector_id")
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS "vfs_acl_entry_provenance_source_idx"
      ON "vfs_acl_entry_provenance" ("provenance_type", "policy_id", "selector_id")
    `);
  }
};

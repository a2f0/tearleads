import type { Pool } from 'pg';
import type { Migration } from './types.js';

/**
 * v006: Add groups and user_groups tables
 *
 * Creates tables for user group management:
 * - groups: Named groups for organizing users
 * - user_groups: Junction table for many-to-many user-group relationships
 */
export const v006: Migration = {
  version: 6,
  description: 'Add groups and user_groups tables',
  up: async (pool: Pool) => {
    const statements = [
      // Groups table
      `CREATE TABLE IF NOT EXISTS "groups" (
        "id" TEXT PRIMARY KEY,
        "name" TEXT NOT NULL,
        "description" TEXT,
        "created_at" TIMESTAMPTZ NOT NULL,
        "updated_at" TIMESTAMPTZ NOT NULL
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "groups_name_idx" ON "groups" ("name")`,

      // User groups junction table
      `CREATE TABLE IF NOT EXISTS "user_groups" (
        "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "group_id" TEXT NOT NULL REFERENCES "groups"("id") ON DELETE CASCADE,
        "joined_at" TIMESTAMPTZ NOT NULL,
        PRIMARY KEY ("user_id", "group_id")
      )`,
      `CREATE INDEX IF NOT EXISTS "user_groups_group_idx" ON "user_groups" ("group_id")`
    ];

    for (const sql of statements) {
      await pool.query(sql);
    }
  }
};

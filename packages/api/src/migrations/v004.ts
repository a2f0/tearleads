import type { Pool } from 'pg';
import type { Migration } from './types.js';

/**
 * v004: Add users and user_credentials tables
 *
 * Adds core user identity storage and password credentials.
 */
export const v004: Migration = {
  version: 4,
  description: 'Add users and user_credentials tables',
  up: async (pool: Pool) => {
    const statements = [
      `CREATE TABLE IF NOT EXISTS "users" (
        "id" TEXT PRIMARY KEY,
        "email" TEXT NOT NULL,
        "email_confirmed" BOOLEAN NOT NULL DEFAULT FALSE
      )`,
      'CREATE INDEX IF NOT EXISTS "users_email_idx" ON "users" ("email")',
      `CREATE TABLE IF NOT EXISTS "user_credentials" (
        "user_id" TEXT PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
        "password_hash" TEXT NOT NULL,
        "password_salt" TEXT NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL,
        "updated_at" TIMESTAMPTZ NOT NULL
      )`
    ];

    for (const sql of statements) {
      await pool.query(sql);
    }
  }
};

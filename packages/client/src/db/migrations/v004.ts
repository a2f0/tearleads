import type { Migration } from './types';
import { addColumnIfNotExists } from './utils';

/**
 * v004: Add users and user_credentials tables
 *
 * Adds core user identity storage and password credentials.
 */
export const v004: Migration = {
  version: 4,
  description: 'Add users and user_credentials tables',
  up: async (adapter) => {
    const statements = [
      `CREATE TABLE IF NOT EXISTS "users" (
        "id" TEXT PRIMARY KEY NOT NULL,
        "email" TEXT NOT NULL,
        "email_confirmed" INTEGER DEFAULT 0 NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS "users_email_idx" ON "users" ("email")`,
      `CREATE TABLE IF NOT EXISTS "user_credentials" (
        "user_id" TEXT PRIMARY KEY NOT NULL,
        "password_hash" TEXT NOT NULL,
        "password_salt" TEXT NOT NULL,
        "created_at" INTEGER NOT NULL,
        "updated_at" INTEGER NOT NULL,
        FOREIGN KEY("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )`
    ];

    await adapter.executeMany(statements);
    await addColumnIfNotExists(
      adapter,
      'users',
      'email_confirmed',
      'INTEGER DEFAULT 0 NOT NULL'
    );
  }
};

import type { Pool } from 'pg';
import type { Migration } from './types.js';

/**
 * v006: Add MLS encrypted chat tables
 *
 * Adds tables for MLS (RFC 9420) encrypted multi-user chat:
 * - mls_key_packages: User public keys for group invites
 * - chat_groups: Group metadata with MLS group ID
 * - chat_group_members: User-group membership
 * - chat_messages: Encrypted message storage
 * - mls_welcomes: Welcome messages for new group members
 */
export const v006: Migration = {
  version: 6,
  description: 'Add MLS encrypted chat tables',
  up: async (pool: Pool) => {
    // MLS KeyPackages - public keys for adding users to groups
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "mls_key_packages" (
        "id" TEXT PRIMARY KEY,
        "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "key_package_data" TEXT NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "consumed" BOOLEAN NOT NULL DEFAULT FALSE
      )
    `);
    await pool.query(
      'CREATE INDEX IF NOT EXISTS "mls_key_packages_user_idx" ON "mls_key_packages"("user_id")'
    );
    await pool.query(
      'CREATE INDEX IF NOT EXISTS "mls_key_packages_consumed_idx" ON "mls_key_packages"("consumed")'
    );

    // Chat Groups - group metadata with MLS group ID
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "chat_groups" (
        "id" TEXT PRIMARY KEY,
        "name" TEXT NOT NULL,
        "created_by" TEXT NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
        "mls_group_id" TEXT NOT NULL UNIQUE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL
      )
    `);
    await pool.query(
      'CREATE INDEX IF NOT EXISTS "chat_groups_created_by_idx" ON "chat_groups"("created_by")'
    );

    // Chat Group Members - user-group membership with roles
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "chat_group_members" (
        "id" TEXT PRIMARY KEY,
        "group_id" TEXT NOT NULL REFERENCES "chat_groups"("id") ON DELETE CASCADE,
        "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "role" TEXT NOT NULL DEFAULT 'member',
        "joined_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        UNIQUE("group_id", "user_id")
      )
    `);
    await pool.query(
      'CREATE INDEX IF NOT EXISTS "chat_group_members_group_idx" ON "chat_group_members"("group_id")'
    );
    await pool.query(
      'CREATE INDEX IF NOT EXISTS "chat_group_members_user_idx" ON "chat_group_members"("user_id")'
    );

    // Chat Messages - encrypted message storage
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "chat_messages" (
        "id" TEXT PRIMARY KEY,
        "group_id" TEXT NOT NULL REFERENCES "chat_groups"("id") ON DELETE CASCADE,
        "sender_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
        "ciphertext" TEXT NOT NULL,
        "epoch" INTEGER NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL
      )
    `);
    await pool.query(
      'CREATE INDEX IF NOT EXISTS "chat_messages_group_idx" ON "chat_messages"("group_id")'
    );
    await pool.query(
      'CREATE INDEX IF NOT EXISTS "chat_messages_sender_idx" ON "chat_messages"("sender_id")'
    );
    await pool.query(
      'CREATE INDEX IF NOT EXISTS "chat_messages_group_created_idx" ON "chat_messages"("group_id", "created_at")'
    );

    // MLS Welcomes - pending welcome messages for new group members
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "mls_welcomes" (
        "id" TEXT PRIMARY KEY,
        "group_id" TEXT NOT NULL REFERENCES "chat_groups"("id") ON DELETE CASCADE,
        "recipient_user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "welcome_data" TEXT NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "fetched" BOOLEAN NOT NULL DEFAULT FALSE
      )
    `);
    await pool.query(
      'CREATE INDEX IF NOT EXISTS "mls_welcomes_recipient_idx" ON "mls_welcomes"("recipient_user_id")'
    );
    await pool.query(
      'CREATE INDEX IF NOT EXISTS "mls_welcomes_group_idx" ON "mls_welcomes"("group_id")'
    );
  }
};

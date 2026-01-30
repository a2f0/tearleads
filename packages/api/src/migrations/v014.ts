import type { Pool } from 'pg';
import type { Migration } from './types.js';

/**
 * v014: Add MLS (RFC 9420) encrypted chat tables
 *
 * Creates:
 * - mls_key_packages: User identity key packages for group additions
 * - mls_groups: MLS group metadata with epoch tracking
 * - mls_group_members: Group membership tracking
 * - mls_messages: Encrypted message storage (ciphertext only)
 * - mls_welcome_messages: Welcome messages for new group members
 * - mls_group_state: Encrypted state snapshots for multi-device sync
 */
export const v014: Migration = {
  version: 14,
  description: 'Add MLS encrypted chat tables',
  up: async (pool: Pool) => {
    await pool.query('BEGIN');
    try {
      // MLS key packages - user identity for group additions
      const createMlsKeyPackagesTable = `CREATE TABLE IF NOT EXISTS "mls_key_packages" (
        "id" TEXT PRIMARY KEY,
        "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "key_package_data" TEXT NOT NULL,
        "key_package_ref" TEXT NOT NULL UNIQUE,
        "cipher_suite" INTEGER NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL,
        "consumed_at" TIMESTAMPTZ,
        "consumed_by_group_id" TEXT
      )`;
      const createMlsKeyPackagesUserIndex =
        'CREATE INDEX IF NOT EXISTS "mls_key_packages_user_idx" ON "mls_key_packages" ("user_id")';

      // MLS groups - group metadata and epoch
      const createMlsGroupsTable = `CREATE TABLE IF NOT EXISTS "mls_groups" (
        "id" TEXT PRIMARY KEY,
        "group_id_mls" TEXT NOT NULL UNIQUE,
        "name" TEXT NOT NULL,
        "description" TEXT,
        "creator_user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
        "current_epoch" INTEGER NOT NULL DEFAULT 0,
        "cipher_suite" INTEGER NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL,
        "updated_at" TIMESTAMPTZ NOT NULL
      )`;
      const createMlsGroupsCreatorIndex =
        'CREATE INDEX IF NOT EXISTS "mls_groups_creator_idx" ON "mls_groups" ("creator_user_id")';

      // MLS group members - membership tracking
      const createMlsGroupMembersTable = `CREATE TABLE IF NOT EXISTS "mls_group_members" (
        "group_id" TEXT NOT NULL REFERENCES "mls_groups"("id") ON DELETE CASCADE,
        "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "leaf_index" INTEGER,
        "role" TEXT NOT NULL DEFAULT 'member' CHECK ("role" IN ('admin', 'member')),
        "joined_at" TIMESTAMPTZ NOT NULL,
        "joined_at_epoch" INTEGER NOT NULL,
        "removed_at" TIMESTAMPTZ,
        PRIMARY KEY ("group_id", "user_id")
      )`;
      const createMlsGroupMembersUserIndex =
        'CREATE INDEX IF NOT EXISTS "mls_group_members_user_idx" ON "mls_group_members" ("user_id")';
      const createMlsGroupMembersActiveIndex =
        'CREATE INDEX IF NOT EXISTS "mls_group_members_active_idx" ON "mls_group_members" ("group_id", "removed_at")';

      // MLS messages - encrypted ciphertext storage
      const createMlsMessagesTable = `CREATE TABLE IF NOT EXISTS "mls_messages" (
        "id" TEXT PRIMARY KEY,
        "group_id" TEXT NOT NULL REFERENCES "mls_groups"("id") ON DELETE CASCADE,
        "sender_user_id" TEXT REFERENCES "users"("id") ON DELETE SET NULL,
        "epoch" INTEGER NOT NULL,
        "ciphertext" TEXT NOT NULL,
        "message_type" TEXT NOT NULL CHECK ("message_type" IN ('application', 'commit', 'proposal')),
        "content_type" TEXT DEFAULT 'text/plain',
        "sequence_number" INTEGER NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL
      )`;
      const createMlsMessagesGroupSeqUnique =
        'CREATE UNIQUE INDEX IF NOT EXISTS "mls_messages_group_seq_unique" ON "mls_messages" ("group_id", "sequence_number")';
      const createMlsMessagesGroupEpochIndex =
        'CREATE INDEX IF NOT EXISTS "mls_messages_group_epoch_idx" ON "mls_messages" ("group_id", "epoch")';
      const createMlsMessagesCreatedIndex =
        'CREATE INDEX IF NOT EXISTS "mls_messages_created_idx" ON "mls_messages" ("created_at")';

      // MLS welcome messages - for new members joining
      const createMlsWelcomeMessagesTable = `CREATE TABLE IF NOT EXISTS "mls_welcome_messages" (
        "id" TEXT PRIMARY KEY,
        "group_id" TEXT NOT NULL REFERENCES "mls_groups"("id") ON DELETE CASCADE,
        "recipient_user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "key_package_ref" TEXT NOT NULL,
        "welcome_data" TEXT NOT NULL,
        "epoch" INTEGER NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL,
        "consumed_at" TIMESTAMPTZ
      )`;
      const createMlsWelcomeRecipientIndex =
        'CREATE INDEX IF NOT EXISTS "mls_welcome_recipient_idx" ON "mls_welcome_messages" ("recipient_user_id", "consumed_at")';
      const createMlsWelcomeGroupIndex =
        'CREATE INDEX IF NOT EXISTS "mls_welcome_group_idx" ON "mls_welcome_messages" ("group_id")';

      // MLS group state - encrypted state snapshots for multi-device sync
      const createMlsGroupStateTable = `CREATE TABLE IF NOT EXISTS "mls_group_state" (
        "id" TEXT PRIMARY KEY,
        "group_id" TEXT NOT NULL REFERENCES "mls_groups"("id") ON DELETE CASCADE,
        "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "epoch" INTEGER NOT NULL,
        "encrypted_state" TEXT NOT NULL,
        "state_hash" TEXT NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL
      )`;
      const createMlsGroupStateUserGroupUnique =
        'CREATE UNIQUE INDEX IF NOT EXISTS "mls_group_state_user_group_unique" ON "mls_group_state" ("group_id", "user_id")';
      const createMlsGroupStateEpochIndex =
        'CREATE INDEX IF NOT EXISTS "mls_group_state_epoch_idx" ON "mls_group_state" ("group_id", "epoch")';

      // Execute all statements
      await pool.query(createMlsKeyPackagesTable);
      await pool.query(createMlsKeyPackagesUserIndex);

      await pool.query(createMlsGroupsTable);
      await pool.query(createMlsGroupsCreatorIndex);

      await pool.query(createMlsGroupMembersTable);
      await pool.query(createMlsGroupMembersUserIndex);
      await pool.query(createMlsGroupMembersActiveIndex);

      await pool.query(createMlsMessagesTable);
      await pool.query(createMlsMessagesGroupSeqUnique);
      await pool.query(createMlsMessagesGroupEpochIndex);
      await pool.query(createMlsMessagesCreatedIndex);

      await pool.query(createMlsWelcomeMessagesTable);
      await pool.query(createMlsWelcomeRecipientIndex);
      await pool.query(createMlsWelcomeGroupIndex);

      await pool.query(createMlsGroupStateTable);
      await pool.query(createMlsGroupStateUserGroupUnique);
      await pool.query(createMlsGroupStateEpochIndex);

      await pool.query('COMMIT');
    } catch (e) {
      await pool.query('ROLLBACK');
      throw e;
    }
  }
};

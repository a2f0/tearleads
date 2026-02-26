import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex
} from 'drizzle-orm/sqlite-core';
import { vfsRegistry } from './schema-content.js';
import { organizations, users } from './schema-foundation.js';

export const vfsCrdtOps = sqliteTable(
  'vfs_crdt_ops',
  {
    id: text('id').primaryKey(),
    itemId: text('item_id')
      .notNull()
      .references(() => vfsRegistry.id, { onDelete: 'cascade' }),
    opType: text('op_type', {
      enum: [
        'acl_add',
        'acl_remove',
        'link_add',
        'link_remove',
        'item_upsert',
        'item_delete'
      ]
    }).notNull(),
    principalType: text('principal_type', {
      enum: ['user', 'group', 'organization']
    }),
    principalId: text('principal_id'),
    accessLevel: text('access_level', {
      enum: ['read', 'write', 'admin']
    }),
    parentId: text('parent_id'),
    childId: text('child_id'),
    actorId: text('actor_id').references(() => users.id, {
      onDelete: 'set null'
    }),
    sourceTable: text('source_table').notNull(),
    sourceId: text('source_id').notNull(),
    occurredAt: integer('occurred_at', { mode: 'timestamp_ms' }).notNull(),
    encryptedPayload: text('encrypted_payload'),
    keyEpoch: integer('key_epoch'),
    encryptionNonce: text('encryption_nonce'),
    encryptionAad: text('encryption_aad'),
    encryptionSignature: text('encryption_signature')
  },
  (table) => [
    index('vfs_crdt_ops_item_idx').on(table.itemId),
    index('vfs_crdt_ops_occurred_idx').on(table.occurredAt),
    index('vfs_crdt_ops_source_idx').on(table.sourceTable, table.sourceId)
  ]
);

/**
 * MLS key packages for user identity.
 * Each package is consumed once when used to add user to a group.
 */
export const mlsKeyPackages = sqliteTable(
  'mls_key_packages',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    keyPackageData: text('key_package_data').notNull(),
    keyPackageRef: text('key_package_ref').notNull(),
    cipherSuite: integer('cipher_suite').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    consumedAt: integer('consumed_at', { mode: 'timestamp_ms' }),
    consumedByGroupId: text('consumed_by_group_id').references(
      () => mlsGroups.id,
      { onDelete: 'set null' }
    )
  },
  (table) => [
    index('mls_key_packages_user_idx').on(table.userId),
    uniqueIndex('mls_key_packages_ref_idx').on(table.keyPackageRef)
  ]
);

/**
 * MLS chat groups with epoch tracking for forward secrecy.
 * Groups manage cryptographic state and membership through MLS protocol.
 */
export const mlsGroups = sqliteTable(
  'mls_groups',
  {
    id: text('id').primaryKey(),
    groupIdMls: text('group_id_mls').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    creatorUserId: text('creator_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    currentEpoch: integer('current_epoch').notNull().default(0),
    cipherSuite: integer('cipher_suite').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
  },
  (table) => [
    uniqueIndex('mls_groups_group_id_mls_idx').on(table.groupIdMls),
    index('mls_groups_org_idx').on(table.organizationId),
    index('mls_groups_creator_idx').on(table.creatorUserId)
  ]
);

/**
 * MLS group membership tracking.
 * Tracks which users are members of which groups with their MLS leaf index.
 */
export const mlsGroupMembers = sqliteTable(
  'mls_group_members',
  {
    groupId: text('group_id')
      .notNull()
      .references(() => mlsGroups.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    leafIndex: integer('leaf_index'),
    role: text('role', {
      enum: ['admin', 'member']
    })
      .notNull()
      .default('member'),
    joinedAt: integer('joined_at', { mode: 'timestamp_ms' }).notNull(),
    joinedAtEpoch: integer('joined_at_epoch').notNull(),
    removedAt: integer('removed_at', { mode: 'timestamp_ms' })
  },
  (table) => [
    primaryKey({ columns: [table.groupId, table.userId] }),
    index('mls_group_members_user_idx').on(table.userId),
    index('mls_group_members_active_idx').on(table.groupId, table.removedAt)
  ]
);

/**
 * MLS encrypted messages.
 * Server stores ciphertext only - decryption happens client-side.
 */
export const mlsMessages = sqliteTable(
  'mls_messages',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id')
      .notNull()
      .references(() => mlsGroups.id, { onDelete: 'cascade' }),
    senderUserId: text('sender_user_id').references(() => users.id, {
      onDelete: 'set null'
    }),
    epoch: integer('epoch').notNull(),
    ciphertext: text('ciphertext').notNull(),
    messageType: text('message_type', {
      enum: ['application', 'commit', 'proposal']
    }).notNull(),
    contentType: text('content_type').default('text/plain'),
    sequenceNumber: integer('sequence_number').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
  },
  (table) => [
    uniqueIndex('mls_messages_group_seq_unique').on(
      table.groupId,
      table.sequenceNumber
    ),
    index('mls_messages_group_epoch_idx').on(table.groupId, table.epoch),
    index('mls_messages_created_idx').on(table.createdAt)
  ]
);

/**
 * MLS welcome messages for new group members.
 * Contains encrypted group state needed to join.
 */
export const mlsWelcomeMessages = sqliteTable(
  'mls_welcome_messages',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id')
      .notNull()
      .references(() => mlsGroups.id, { onDelete: 'cascade' }),
    recipientUserId: text('recipient_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    keyPackageRef: text('key_package_ref').notNull(),
    welcomeData: text('welcome_data').notNull(),
    epoch: integer('epoch').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    consumedAt: integer('consumed_at', { mode: 'timestamp_ms' })
  },
  (table) => [
    index('mls_welcome_recipient_idx').on(
      table.recipientUserId,
      table.consumedAt
    ),
    index('mls_welcome_group_idx').on(table.groupId)
  ]
);

/**
 * MLS group state snapshots for recovery and multi-device sync.
 * Stores encrypted serialized MLS state at specific epochs.
 */
export const mlsGroupState = sqliteTable(
  'mls_group_state',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id')
      .notNull()
      .references(() => mlsGroups.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    epoch: integer('epoch').notNull(),
    encryptedState: text('encrypted_state').notNull(),
    stateHash: text('state_hash').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
  },
  (table) => [
    uniqueIndex('mls_group_state_user_group_unique').on(
      table.groupId,
      table.userId
    ),
    index('mls_group_state_epoch_idx').on(table.groupId, table.epoch)
  ]
);

/**
 * AI usage - tracks token usage per request for billing/analytics.
 * Usage data is stored in plaintext (not encrypted) for aggregation.
 */
export const aiUsage = sqliteTable(
  'ai_usage',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id').references(() => vfsRegistry.id, {
      onDelete: 'set null'
    }),
    messageId: text('message_id'),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id').references(() => organizations.id, {
      onDelete: 'set null'
    }),
    modelId: text('model_id').notNull(),
    promptTokens: integer('prompt_tokens').notNull(),
    completionTokens: integer('completion_tokens').notNull(),
    totalTokens: integer('total_tokens').notNull(),
    openrouterRequestId: text('openrouter_request_id'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
  },
  (table) => [
    index('ai_usage_user_idx').on(table.userId, table.createdAt),
    index('ai_usage_org_idx').on(table.organizationId, table.createdAt),
    index('ai_usage_conversation_idx').on(table.conversationId)
  ]
);

/**
 * Schema object containing all table definitions.
 */

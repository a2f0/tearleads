import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex
} from 'drizzle-orm/pg-core';
import { vfsRegistry } from './schema-content.js';
import { users } from './schema-foundation.js';

export const vfsSharePolicies = pgTable(
  'vfs_share_policies',
  {
    id: text('id').primaryKey(),
    rootItemId: text('root_item_id')
      .notNull()
      .references(() => vfsRegistry.id, { onDelete: 'cascade' }),
    status: text('status', {
      enum: ['draft', 'active', 'paused', 'revoked']
    })
      .notNull()
      .default('draft'),
    name: text('name'),
    createdBy: text('created_by').references(() => users.id, {
      onDelete: 'set null'
    }),
    schemaVersion: integer('schema_version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true })
  },
  (table) => [
    index('vfs_share_policies_root_idx').on(table.rootItemId),
    index('vfs_share_policies_status_idx').on(table.status),
    index('vfs_share_policies_created_by_idx').on(table.createdBy)
  ]
);

/**
 * Selectors for share policies.
 * Supports include/exclude rules, depth constraints, and object-type filters.
 */
export const vfsSharePolicySelectors = pgTable(
  'vfs_share_policy_selectors',
  {
    id: text('id').primaryKey(),
    policyId: text('policy_id')
      .notNull()
      .references(() => vfsSharePolicies.id, { onDelete: 'cascade' }),
    selectorKind: text('selector_kind', {
      enum: ['include', 'exclude']
    }).notNull(),
    matchMode: text('match_mode', {
      enum: ['subtree', 'children', 'exact']
    })
      .notNull()
      .default('subtree'),
    anchorItemId: text('anchor_item_id').references(() => vfsRegistry.id, {
      onDelete: 'set null'
    }),
    maxDepth: integer('max_depth'),
    includeRoot: boolean('include_root').notNull().default(true),
    objectTypes: jsonb('object_types'),
    selectorOrder: integer('selector_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull()
  },
  (table) => [
    index('vfs_share_policy_selectors_policy_idx').on(table.policyId),
    index('vfs_share_policy_selectors_anchor_idx').on(table.anchorItemId),
    uniqueIndex('vfs_share_policy_selectors_policy_order_idx').on(
      table.policyId,
      table.selectorOrder
    )
  ]
);

/**
 * Principal targets for share policies.
 * Maps policy headers to user/group/organization grants.
 */
export const vfsSharePolicyPrincipals = pgTable(
  'vfs_share_policy_principals',
  {
    id: text('id').primaryKey(),
    policyId: text('policy_id')
      .notNull()
      .references(() => vfsSharePolicies.id, { onDelete: 'cascade' }),
    principalType: text('principal_type', {
      enum: ['user', 'group', 'organization']
    }).notNull(),
    principalId: text('principal_id').notNull(),
    accessLevel: text('access_level', {
      enum: ['read', 'write', 'admin']
    }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull()
  },
  (table) => [
    index('vfs_share_policy_principals_policy_idx').on(table.policyId),
    index('vfs_share_policy_principals_target_idx').on(
      table.principalType,
      table.principalId
    ),
    uniqueIndex('vfs_share_policy_principals_unique_idx').on(
      table.policyId,
      table.principalType,
      table.principalId
    )
  ]
);

/**
 * Provenance metadata for effective ACL rows.
 * Tracks direct-vs-policy derived decisions and compiler run attribution.
 */
export const vfsAclEntryProvenance = pgTable(
  'vfs_acl_entry_provenance',
  {
    id: text('id').primaryKey(),
    aclEntryId: text('acl_entry_id')
      .notNull()
      .references(() => vfsAclEntries.id, { onDelete: 'cascade' }),
    provenanceType: text('provenance_type', {
      enum: ['direct', 'derivedPolicy']
    }).notNull(),
    policyId: text('policy_id').references(() => vfsSharePolicies.id, {
      onDelete: 'set null'
    }),
    selectorId: text('selector_id').references(
      () => vfsSharePolicySelectors.id,
      { onDelete: 'set null' }
    ),
    decision: text('decision', {
      enum: ['allow', 'deny']
    })
      .notNull()
      .default('allow'),
    precedence: integer('precedence').notNull().default(0),
    compiledAt: timestamp('compiled_at', { withTimezone: true }),
    compilerRunId: text('compiler_run_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull()
  },
  (table) => [
    index('vfs_acl_entry_provenance_acl_entry_idx').on(table.aclEntryId),
    index('vfs_acl_entry_provenance_policy_idx').on(table.policyId),
    index('vfs_acl_entry_provenance_selector_idx').on(table.selectorId),
    index('vfs_acl_entry_provenance_source_idx').on(
      table.provenanceType,
      table.policyId,
      table.selectorId
    )
  ]
);

/**
 * Flattened ACL entries for VFS items.
 * Unifies user/group/organization grants into a single principal model.
 */
export const vfsAclEntries = pgTable(
  'vfs_acl_entries',
  {
    id: text('id').primaryKey(),
    itemId: text('item_id')
      .notNull()
      .references(() => vfsRegistry.id, { onDelete: 'cascade' }),
    principalType: text('principal_type', {
      enum: ['user', 'group', 'organization']
    }).notNull(),
    principalId: text('principal_id').notNull(),
    accessLevel: text('access_level', {
      enum: ['read', 'write', 'admin']
    }).notNull(),
    wrappedSessionKey: text('wrapped_session_key'),
    wrappedHierarchicalKey: text('wrapped_hierarchical_key'),
    keyEpoch: integer('key_epoch'),
    grantedBy: text('granted_by').references(() => users.id, {
      onDelete: 'restrict'
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true })
  },
  (table) => [
    index('vfs_acl_entries_item_idx').on(table.itemId),
    index('vfs_acl_entries_principal_idx').on(
      table.principalType,
      table.principalId
    ),
    index('vfs_acl_entries_active_idx').on(
      table.principalType,
      table.principalId,
      table.revokedAt,
      table.expiresAt
    ),
    uniqueIndex('vfs_acl_entries_item_principal_idx').on(
      table.itemId,
      table.principalType,
      table.principalId
    )
  ]
);

/**
 * Canonical encrypted state for VFS items.
 * Stores latest encrypted payload snapshot for non-blob content.
 */
export const vfsItemState = pgTable(
  'vfs_item_state',
  {
    itemId: text('item_id')
      .primaryKey()
      .references(() => vfsRegistry.id, { onDelete: 'cascade' }),
    encryptedPayload: text('encrypted_payload'),
    keyEpoch: integer('key_epoch'),
    encryptionNonce: text('encryption_nonce'),
    encryptionAad: text('encryption_aad'),
    encryptionSignature: text('encryption_signature'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true })
  },
  (table) => [
    index('vfs_item_state_updated_idx').on(table.updatedAt),
    index('vfs_item_state_deleted_idx').on(table.deletedAt)
  ]
);

/**
 * Append-only VFS change feed for cursor-based differential synchronization.
 * Records all item and ACL mutations in a stable time-ordered stream.
 */
export const vfsSyncChanges = pgTable(
  'vfs_sync_changes',
  {
    id: text('id').primaryKey(),
    itemId: text('item_id')
      .notNull()
      .references(() => vfsRegistry.id, { onDelete: 'cascade' }),
    changeType: text('change_type', {
      enum: ['upsert', 'delete', 'acl']
    }).notNull(),
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull(),
    changedBy: text('changed_by').references(() => users.id, {
      onDelete: 'set null'
    }),
    rootId: text('root_id').references(() => vfsRegistry.id, {
      onDelete: 'set null'
    })
  },
  (table) => [
    index('vfs_sync_changes_item_idx').on(table.itemId),
    index('vfs_sync_changes_changed_at_idx').on(table.changedAt),
    index('vfs_sync_changes_root_idx').on(table.rootId),
    index('vfs_sync_changes_item_changed_idx').on(table.itemId, table.changedAt)
  ]
);

/**
 * Per-user/per-client sync cursor reconciliation state.
 * Tracks the latest cursor each client has fully applied.
 */
export const vfsSyncClientState = pgTable(
  'vfs_sync_client_state',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    clientId: text('client_id').notNull(),
    lastReconciledAt: timestamp('last_reconciled_at', {
      withTimezone: true
    }).notNull(),
    lastReconciledChangeId: text('last_reconciled_change_id').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull()
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.clientId] }),
    index('vfs_sync_client_state_user_idx').on(table.userId)
  ]
);

/**
 * CRDT-style operation log for ACL and link mutations.
 * Ensures deterministic convergence for concurrent multi-client updates.
 */

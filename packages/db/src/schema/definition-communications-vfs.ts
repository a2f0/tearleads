import { communicationsVfsBlobTables } from './definitionCommunicationsVfsBlob.js';
import type { TableDefinition } from './types.js';

/**
 * Flattened ACL entries for VFS items.
 * Unifies user/group/organization grants into a single principal model.
 */
export const vfsAclEntriesTable: TableDefinition = {
  name: 'vfs_acl_entries',
  propertyName: 'vfsAclEntries',
  comment:
    'Flattened ACL entries for VFS items.\nUnifies user/group/organization grants into a single principal model.',
  columns: {
    id: {
      type: 'text',
      sqlName: 'id',
      primaryKey: true
    },
    itemId: {
      type: 'text',
      sqlName: 'item_id',
      notNull: true,
      references: {
        table: 'vfs_registry',
        column: 'id',
        onDelete: 'cascade'
      }
    },
    principalType: {
      type: 'text',
      sqlName: 'principal_type',
      notNull: true,
      enumValues: ['user', 'group', 'organization'] as const
    },
    principalId: {
      type: 'text',
      sqlName: 'principal_id',
      notNull: true
    },
    accessLevel: {
      type: 'text',
      sqlName: 'access_level',
      notNull: true,
      enumValues: ['read', 'write', 'admin'] as const
    },
    wrappedSessionKey: {
      type: 'text',
      sqlName: 'wrapped_session_key'
    },
    wrappedHierarchicalKey: {
      type: 'text',
      sqlName: 'wrapped_hierarchical_key'
    },
    keyEpoch: {
      type: 'integer',
      sqlName: 'key_epoch'
    },
    grantedBy: {
      type: 'text',
      sqlName: 'granted_by',
      references: {
        table: 'users',
        column: 'id',
        onDelete: 'restrict'
      }
    },
    createdAt: {
      type: 'timestamp',
      sqlName: 'created_at',
      notNull: true
    },
    updatedAt: {
      type: 'timestamp',
      sqlName: 'updated_at',
      notNull: true
    },
    expiresAt: {
      type: 'timestamp',
      sqlName: 'expires_at'
    },
    revokedAt: {
      type: 'timestamp',
      sqlName: 'revoked_at'
    }
  },
  indexes: [
    { name: 'vfs_acl_entries_item_idx', columns: ['itemId'] },
    {
      name: 'vfs_acl_entries_principal_idx',
      columns: ['principalType', 'principalId']
    },
    {
      name: 'vfs_acl_entries_active_idx',
      columns: ['principalType', 'principalId', 'revokedAt', 'expiresAt']
    },
    {
      name: 'vfs_acl_entries_item_principal_idx',
      columns: ['itemId', 'principalType', 'principalId'],
      unique: true
    }
  ]
};

/**
 * Canonical encrypted state for VFS items.
 * Stores latest encrypted payload snapshot for non-blob content.
 */
const vfsItemStateTable: TableDefinition = {
  name: 'vfs_item_state',
  propertyName: 'vfsItemState',
  comment:
    'Canonical encrypted state for VFS items.\nStores latest encrypted payload snapshot for non-blob content.',
  columns: {
    itemId: {
      type: 'text',
      sqlName: 'item_id',
      primaryKey: true,
      references: {
        table: 'vfs_registry',
        column: 'id',
        onDelete: 'cascade'
      }
    },
    encryptedPayload: {
      type: 'text',
      sqlName: 'encrypted_payload'
    },
    keyEpoch: {
      type: 'integer',
      sqlName: 'key_epoch'
    },
    encryptionNonce: {
      type: 'text',
      sqlName: 'encryption_nonce'
    },
    encryptionAad: {
      type: 'text',
      sqlName: 'encryption_aad'
    },
    encryptionSignature: {
      type: 'text',
      sqlName: 'encryption_signature'
    },
    updatedAt: {
      type: 'timestamp',
      sqlName: 'updated_at',
      notNull: true
    },
    deletedAt: {
      type: 'timestamp',
      sqlName: 'deleted_at'
    }
  },
  indexes: [
    { name: 'vfs_item_state_updated_idx', columns: ['updatedAt'] },
    { name: 'vfs_item_state_deleted_idx', columns: ['deletedAt'] }
  ]
};

/**
 * Append-only VFS change feed for cursor-based differential synchronization.
 * Records all item and ACL mutations in a stable time-ordered stream.
 */
export const vfsSyncChangesTable: TableDefinition = {
  name: 'vfs_sync_changes',
  propertyName: 'vfsSyncChanges',
  comment:
    'Append-only VFS change feed for cursor-based differential synchronization.\nRecords all item and ACL mutations in a stable time-ordered stream.',
  columns: {
    id: {
      type: 'text',
      sqlName: 'id',
      primaryKey: true
    },
    itemId: {
      type: 'text',
      sqlName: 'item_id',
      notNull: true,
      references: {
        table: 'vfs_registry',
        column: 'id',
        onDelete: 'cascade'
      }
    },
    changeType: {
      type: 'text',
      sqlName: 'change_type',
      notNull: true,
      enumValues: ['upsert', 'delete', 'acl'] as const
    },
    changedAt: {
      type: 'timestamp',
      sqlName: 'changed_at',
      notNull: true
    },
    changedBy: {
      type: 'text',
      sqlName: 'changed_by',
      references: {
        table: 'users',
        column: 'id',
        onDelete: 'set null'
      }
    },
    rootId: {
      type: 'text',
      sqlName: 'root_id',
      references: {
        table: 'vfs_registry',
        column: 'id',
        onDelete: 'set null'
      }
    }
  },
  indexes: [
    { name: 'vfs_sync_changes_item_idx', columns: ['itemId'] },
    { name: 'vfs_sync_changes_changed_at_idx', columns: ['changedAt'] },
    { name: 'vfs_sync_changes_root_idx', columns: ['rootId'] },
    {
      name: 'vfs_sync_changes_item_changed_idx',
      columns: ['itemId', 'changedAt']
    }
  ]
};

/**
 * Per-user/per-client sync cursor reconciliation state.
 * Tracks the latest cursor each client has fully applied.
 */
export const vfsSyncClientStateTable: TableDefinition = {
  name: 'vfs_sync_client_state',
  propertyName: 'vfsSyncClientState',
  comment:
    'Per-user/per-client sync cursor reconciliation state.\nTracks the latest cursor each client has fully applied.',
  columns: {
    userId: {
      type: 'text',
      sqlName: 'user_id',
      primaryKey: true,
      references: {
        table: 'users',
        column: 'id',
        onDelete: 'cascade'
      }
    },
    clientId: {
      type: 'text',
      sqlName: 'client_id',
      primaryKey: true
    },
    lastReconciledAt: {
      type: 'timestamp',
      sqlName: 'last_reconciled_at',
      notNull: true
    },
    lastReconciledChangeId: {
      type: 'text',
      sqlName: 'last_reconciled_change_id',
      notNull: true
    },
    updatedAt: {
      type: 'timestamp',
      sqlName: 'updated_at',
      notNull: true
    }
  },
  indexes: [{ name: 'vfs_sync_client_state_user_idx', columns: ['userId'] }]
};

export {
  vfsBlobObjectsTable,
  vfsBlobRefsTable,
  vfsBlobStagingTable
} from './definitionCommunicationsVfsBlob.js';

export const communicationsVfsTables: TableDefinition[] = [
  vfsAclEntriesTable,
  vfsItemStateTable,
  vfsSyncChangesTable,
  vfsSyncClientStateTable,
  ...communicationsVfsBlobTables
];

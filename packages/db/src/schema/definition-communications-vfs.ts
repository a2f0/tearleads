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

/**
 * Blob object registry for VFS-backed binary payloads.
 * Tracks immutable blob metadata independent of attachment lifecycle.
 */
export const vfsBlobObjectsTable: TableDefinition = {
  name: 'vfs_blob_objects',
  propertyName: 'vfsBlobObjects',
  comment:
    'Blob object registry for VFS-backed binary payloads.\nTracks immutable blob metadata independent of attachment lifecycle.',
  columns: {
    id: {
      type: 'text',
      sqlName: 'id',
      primaryKey: true
    },
    sha256: {
      type: 'text',
      sqlName: 'sha256',
      notNull: true
    },
    sizeBytes: {
      type: 'integer',
      sqlName: 'size_bytes',
      notNull: true
    },
    storageKey: {
      type: 'text',
      sqlName: 'storage_key',
      notNull: true
    },
    createdBy: {
      type: 'text',
      sqlName: 'created_by',
      notNull: true,
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
    }
  },
  indexes: [
    {
      name: 'vfs_blob_objects_storage_key_idx',
      columns: ['storageKey'],
      unique: true
    },
    { name: 'vfs_blob_objects_sha_idx', columns: ['sha256'] }
  ]
};

/**
 * Blob staging table for commit-isolated attachment flow.
 * Blobs are staged first, then atomically attached to VFS items.
 */
export const vfsBlobStagingTable: TableDefinition = {
  name: 'vfs_blob_staging',
  propertyName: 'vfsBlobStaging',
  comment:
    'Blob staging table for commit-isolated attachment flow.\nBlobs are staged first, then atomically attached to VFS items.',
  columns: {
    id: {
      type: 'text',
      sqlName: 'id',
      primaryKey: true
    },
    blobId: {
      type: 'text',
      sqlName: 'blob_id',
      notNull: true,
      references: {
        table: 'vfs_blob_objects',
        column: 'id',
        onDelete: 'cascade'
      }
    },
    stagedBy: {
      type: 'text',
      sqlName: 'staged_by',
      notNull: true,
      references: {
        table: 'users',
        column: 'id',
        onDelete: 'cascade'
      }
    },
    status: {
      type: 'text',
      sqlName: 'status',
      notNull: true,
      enumValues: ['staged', 'attached', 'abandoned'] as const
    },
    stagedAt: {
      type: 'timestamp',
      sqlName: 'staged_at',
      notNull: true
    },
    attachedAt: {
      type: 'timestamp',
      sqlName: 'attached_at'
    },
    expiresAt: {
      type: 'timestamp',
      sqlName: 'expires_at',
      notNull: true
    },
    attachedItemId: {
      type: 'text',
      sqlName: 'attached_item_id',
      references: {
        table: 'vfs_registry',
        column: 'id',
        onDelete: 'set null'
      }
    }
  },
  indexes: [
    { name: 'vfs_blob_staging_status_idx', columns: ['status'] },
    { name: 'vfs_blob_staging_expires_idx', columns: ['expiresAt'] },
    { name: 'vfs_blob_staging_staged_by_idx', columns: ['stagedBy'] }
  ]
};

/**
 * Blob attachment references linking blobs to VFS items.
 */
export const vfsBlobRefsTable: TableDefinition = {
  name: 'vfs_blob_refs',
  propertyName: 'vfsBlobRefs',
  comment: 'Blob attachment references linking blobs to VFS items.',
  columns: {
    id: {
      type: 'text',
      sqlName: 'id',
      primaryKey: true
    },
    blobId: {
      type: 'text',
      sqlName: 'blob_id',
      notNull: true,
      references: {
        table: 'vfs_blob_objects',
        column: 'id',
        onDelete: 'cascade'
      }
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
    relationKind: {
      type: 'text',
      sqlName: 'relation_kind',
      notNull: true,
      enumValues: ['file', 'emailAttachment', 'photo', 'other'] as const
    },
    attachedBy: {
      type: 'text',
      sqlName: 'attached_by',
      notNull: true,
      references: {
        table: 'users',
        column: 'id',
        onDelete: 'restrict'
      }
    },
    attachedAt: {
      type: 'timestamp',
      sqlName: 'attached_at',
      notNull: true
    }
  },
  indexes: [
    { name: 'vfs_blob_refs_item_idx', columns: ['itemId'] },
    { name: 'vfs_blob_refs_blob_idx', columns: ['blobId'] },
    {
      name: 'vfs_blob_refs_unique_idx',
      columns: ['blobId', 'itemId', 'relationKind'],
      unique: true
    }
  ]
};

export const communicationsVfsTables: TableDefinition[] = [
  vfsAclEntriesTable,
  vfsSyncChangesTable,
  vfsSyncClientStateTable,
  vfsBlobObjectsTable,
  vfsBlobStagingTable,
  vfsBlobRefsTable
];

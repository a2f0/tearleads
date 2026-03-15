import type { TableDefinition } from './types.js';

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

/**
 * Blob manifest metadata persisted at commit time.
 * Enables chunked download by storing chunk boundaries and hashes.
 */
const vfsBlobManifestsTable: TableDefinition = {
  name: 'vfs_blob_manifests',
  propertyName: 'vfsBlobManifests',
  comment:
    'Blob manifest metadata persisted at commit time.\nEnables chunked download by storing chunk boundaries and hashes.',
  columns: {
    blobId: {
      type: 'text',
      sqlName: 'blob_id',
      primaryKey: true,
      references: {
        table: 'vfs_blob_objects',
        column: 'id',
        onDelete: 'cascade'
      }
    },
    keyEpoch: {
      type: 'integer',
      sqlName: 'key_epoch',
      notNull: true
    },
    chunkCount: {
      type: 'integer',
      sqlName: 'chunk_count',
      notNull: true
    },
    totalPlaintextBytes: {
      type: 'bigint',
      sqlName: 'total_plaintext_bytes',
      notNull: true
    },
    totalCiphertextBytes: {
      type: 'bigint',
      sqlName: 'total_ciphertext_bytes',
      notNull: true
    },
    chunkHashes: {
      type: 'json',
      sqlName: 'chunk_hashes',
      notNull: true
    },
    chunkBoundaries: {
      type: 'json',
      sqlName: 'chunk_boundaries',
      notNull: true
    },
    manifestHash: {
      type: 'text',
      sqlName: 'manifest_hash',
      notNull: true
    },
    manifestSignature: {
      type: 'text',
      sqlName: 'manifest_signature',
      notNull: true
    },
    createdAt: {
      type: 'timestamp',
      sqlName: 'created_at',
      notNull: true
    }
  },
  indexes: []
};

export const communicationsVfsBlobTables: TableDefinition[] = [
  vfsBlobObjectsTable,
  vfsBlobStagingTable,
  vfsBlobRefsTable,
  vfsBlobManifestsTable
];

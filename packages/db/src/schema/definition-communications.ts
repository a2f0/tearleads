import type { TableDefinition } from './types.js';
export const contactGroupsTable: TableDefinition = {
  name: 'contact_groups',
  propertyName: 'contactGroups',
  comment:
    'Contact groups - extends registry for contactGroup-type items.\nStores encrypted contact group metadata.',
  columns: {
    id: {
      type: 'text',
      sqlName: 'id',
      primaryKey: true,
      references: {
        table: 'vfs_registry',
        column: 'id',
        onDelete: 'cascade'
      }
    },
    encryptedName: {
      type: 'text',
      sqlName: 'encrypted_name'
    },
    color: {
      type: 'text',
      sqlName: 'color'
    },
    icon: {
      type: 'text',
      sqlName: 'icon'
    }
  }
};

/**
 * Email folders - extends registry for emailFolder-type items.
 * Stores email folder metadata including sync state for IMAP.
 */
export const emailFoldersTable: TableDefinition = {
  name: 'email_folders',
  propertyName: 'emailFolders',
  comment:
    'Email folders - extends registry for emailFolder-type items.\nStores email folder metadata including sync state for IMAP.',
  columns: {
    id: {
      type: 'text',
      sqlName: 'id',
      primaryKey: true,
      references: {
        table: 'vfs_registry',
        column: 'id',
        onDelete: 'cascade'
      }
    },
    encryptedName: {
      type: 'text',
      sqlName: 'encrypted_name'
    },
    folderType: {
      type: 'text',
      sqlName: 'folder_type',
      enumValues: [
        'inbox',
        'sent',
        'drafts',
        'trash',
        'spam',
        'custom'
      ] as const
    },
    unreadCount: {
      type: 'integer',
      sqlName: 'unread_count',
      notNull: true,
      defaultValue: 0
    },
    syncUidValidity: {
      type: 'integer',
      sqlName: 'sync_uid_validity'
    },
    syncLastUid: {
      type: 'integer',
      sqlName: 'sync_last_uid'
    }
  }
};

/**
 * Tags - extends registry for tag-type items.
 * Stores tag metadata for cross-cutting organization.
 */
export const tagsTable: TableDefinition = {
  name: 'tags',
  propertyName: 'tags',
  comment:
    'Tags - extends registry for tag-type items.\nStores tag metadata for cross-cutting organization.',
  columns: {
    id: {
      type: 'text',
      sqlName: 'id',
      primaryKey: true,
      references: {
        table: 'vfs_registry',
        column: 'id',
        onDelete: 'cascade'
      }
    },
    encryptedName: {
      type: 'text',
      sqlName: 'encrypted_name'
    },
    color: {
      type: 'text',
      sqlName: 'color'
    },
    icon: {
      type: 'text',
      sqlName: 'icon'
    },
    deleted: {
      type: 'boolean',
      sqlName: 'deleted',
      notNull: true,
      defaultValue: false
    }
  },
  indexes: [{ name: 'tags_deleted_idx', columns: ['deleted'] }]
};

/**
 * Wallet items - extends registry for walletItem-type entries.
 * Stores structured identity and payment card metadata with soft-delete support.
 */
export const walletItemsTable: TableDefinition = {
  name: 'wallet_items',
  propertyName: 'walletItems',
  comment:
    'Wallet items - extends registry for walletItem-type entries.\nStores structured identity and payment card metadata with soft-delete support.',
  columns: {
    id: {
      type: 'text',
      sqlName: 'id',
      primaryKey: true,
      references: {
        table: 'vfs_registry',
        column: 'id',
        onDelete: 'cascade'
      }
    },
    itemType: {
      type: 'text',
      sqlName: 'item_type',
      notNull: true,
      enumValues: [
        'passport',
        'driverLicense',
        'birthCertificate',
        'creditCard',
        'debitCard',
        'identityCard',
        'insuranceCard',
        'other'
      ] as const
    },
    displayName: {
      type: 'text',
      sqlName: 'display_name',
      notNull: true
    },
    issuingAuthority: {
      type: 'text',
      sqlName: 'issuing_authority'
    },
    countryCode: {
      type: 'text',
      sqlName: 'country_code'
    },
    documentNumberLast4: {
      type: 'text',
      sqlName: 'document_number_last4'
    },
    issuedOn: {
      type: 'timestamp',
      sqlName: 'issued_on'
    },
    expiresOn: {
      type: 'timestamp',
      sqlName: 'expires_on'
    },
    notes: {
      type: 'text',
      sqlName: 'notes'
    },
    metadata: {
      type: 'json',
      sqlName: 'metadata'
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
    deleted: {
      type: 'boolean',
      sqlName: 'deleted',
      notNull: true,
      defaultValue: false
    }
  },
  indexes: [
    { name: 'wallet_items_type_idx', columns: ['itemType'] },
    { name: 'wallet_items_expires_idx', columns: ['expiresOn'] },
    { name: 'wallet_items_deleted_idx', columns: ['deleted'] },
    { name: 'wallet_items_updated_idx', columns: ['updatedAt'] }
  ]
};

/**
 * Wallet item media links front/back card images to files.
 */
export const walletItemMediaTable: TableDefinition = {
  name: 'wallet_item_media',
  propertyName: 'walletItemMedia',
  comment: 'Wallet item media links front/back card images to files.',
  columns: {
    id: {
      type: 'text',
      sqlName: 'id',
      primaryKey: true
    },
    walletItemId: {
      type: 'text',
      sqlName: 'wallet_item_id',
      notNull: true,
      references: {
        table: 'wallet_items',
        column: 'id',
        onDelete: 'cascade'
      }
    },
    fileId: {
      type: 'text',
      sqlName: 'file_id',
      notNull: true,
      references: {
        table: 'files',
        column: 'id',
        onDelete: 'cascade'
      }
    },
    side: {
      type: 'text',
      sqlName: 'side',
      notNull: true,
      enumValues: ['front', 'back'] as const
    },
    createdAt: {
      type: 'timestamp',
      sqlName: 'created_at',
      notNull: true
    }
  },
  indexes: [
    { name: 'wallet_item_media_item_idx', columns: ['walletItemId'] },
    { name: 'wallet_item_media_file_idx', columns: ['fileId'] },
    {
      name: 'wallet_item_media_item_side_idx',
      columns: ['walletItemId', 'side'],
      unique: true
    }
  ]
};

/**
 * Emails - extends registry for email-type items.
 * Stores encrypted email metadata.
 */
export const emailsTable: TableDefinition = {
  name: 'emails',
  propertyName: 'emails',
  comment:
    'Emails - extends registry for email-type items.\nStores encrypted email metadata.',
  columns: {
    id: {
      type: 'text',
      sqlName: 'id',
      primaryKey: true,
      references: {
        table: 'vfs_registry',
        column: 'id',
        onDelete: 'cascade'
      }
    },
    encryptedSubject: {
      type: 'text',
      sqlName: 'encrypted_subject'
    },
    encryptedFrom: {
      type: 'text',
      sqlName: 'encrypted_from'
    },
    encryptedTo: {
      type: 'json',
      sqlName: 'encrypted_to'
    },
    encryptedCc: {
      type: 'json',
      sqlName: 'encrypted_cc'
    },
    encryptedBodyPath: {
      type: 'text',
      sqlName: 'encrypted_body_path'
    },
    receivedAt: {
      type: 'timestamp',
      sqlName: 'received_at',
      notNull: true
    },
    isRead: {
      type: 'boolean',
      sqlName: 'is_read',
      notNull: true,
      defaultValue: false
    },
    isStarred: {
      type: 'boolean',
      sqlName: 'is_starred',
      notNull: true,
      defaultValue: false
    }
  },
  indexes: [{ name: 'emails_received_at_idx', columns: ['receivedAt'] }]
};

/**
 * Composed emails - extends registry for draft and sent email items.
 * Stores encrypted composed email content for drafts and sent messages.
 */
export const composedEmailsTable: TableDefinition = {
  name: 'composed_emails',
  propertyName: 'composedEmails',
  comment:
    'Composed emails - extends registry for draft and sent email items.\nStores encrypted composed email content for drafts and sent messages.',
  columns: {
    id: {
      type: 'text',
      sqlName: 'id',
      primaryKey: true,
      references: {
        table: 'vfs_registry',
        column: 'id',
        onDelete: 'cascade'
      }
    },
    encryptedTo: {
      type: 'json',
      sqlName: 'encrypted_to'
    },
    encryptedCc: {
      type: 'json',
      sqlName: 'encrypted_cc'
    },
    encryptedBcc: {
      type: 'json',
      sqlName: 'encrypted_bcc'
    },
    encryptedSubject: {
      type: 'text',
      sqlName: 'encrypted_subject'
    },
    encryptedBody: {
      type: 'text',
      sqlName: 'encrypted_body'
    },
    status: {
      type: 'text',
      sqlName: 'status',
      notNull: true,
      defaultValue: 'draft',
      enumValues: ['draft', 'sending', 'sent', 'failed'] as const
    },
    sentAt: {
      type: 'timestamp',
      sqlName: 'sent_at'
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
    }
  },
  indexes: [
    { name: 'composed_emails_status_idx', columns: ['status'] },
    { name: 'composed_emails_updated_idx', columns: ['updatedAt'] }
  ]
};

/**
 * Email attachments - file references for composed emails.
 * Links attachments to composed emails with metadata.
 */
export const emailAttachmentsTable: TableDefinition = {
  name: 'email_attachments',
  propertyName: 'emailAttachments',
  comment:
    'Email attachments - file references for composed emails.\nLinks attachments to composed emails with metadata.',
  columns: {
    id: {
      type: 'text',
      sqlName: 'id',
      primaryKey: true
    },
    composedEmailId: {
      type: 'text',
      sqlName: 'composed_email_id',
      notNull: true,
      references: {
        table: 'composed_emails',
        column: 'id',
        onDelete: 'cascade'
      }
    },
    encryptedFileName: {
      type: 'text',
      sqlName: 'encrypted_file_name',
      notNull: true
    },
    mimeType: {
      type: 'text',
      sqlName: 'mime_type',
      notNull: true
    },
    size: {
      type: 'integer',
      sqlName: 'size',
      notNull: true
    },
    encryptedStoragePath: {
      type: 'text',
      sqlName: 'encrypted_storage_path',
      notNull: true
    },
    createdAt: {
      type: 'timestamp',
      sqlName: 'created_at',
      notNull: true
    }
  },
  indexes: [
    { name: 'email_attachments_email_idx', columns: ['composedEmailId'] }
  ]
};

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

/**
 * CRDT-style operation log for ACL and link mutations.
 * Ensures deterministic convergence for concurrent multi-client updates.
 */

export const communicationsTables: TableDefinition[] = [
  contactGroupsTable,
  emailFoldersTable,
  tagsTable,
  walletItemsTable,
  walletItemMediaTable,
  emailsTable,
  composedEmailsTable,
  emailAttachmentsTable,
  vfsAclEntriesTable,
  vfsSyncChangesTable,
  vfsSyncClientStateTable,
  vfsBlobObjectsTable,
  vfsBlobStagingTable,
  vfsBlobRefsTable
];

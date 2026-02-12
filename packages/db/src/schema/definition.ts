import type { TableDefinition } from './types.js';

/**
 * Sync metadata table for tracking entity sync status.
 * Designed for future cloud sync capabilities.
 */
export const syncMetadataTable: TableDefinition = {
  name: 'sync_metadata',
  propertyName: 'syncMetadata',
  comment:
    'Sync metadata table for tracking entity sync status.\nDesigned for future cloud sync capabilities.',
  columns: {
    id: {
      type: 'text',
      sqlName: 'id',
      primaryKey: true
    },
    entityType: {
      type: 'text',
      sqlName: 'entity_type',
      notNull: true
    },
    entityId: {
      type: 'text',
      sqlName: 'entity_id',
      notNull: true
    },
    version: {
      type: 'integer',
      sqlName: 'version',
      notNull: true,
      defaultValue: 0
    },
    lastModified: {
      type: 'timestamp',
      sqlName: 'last_modified',
      notNull: true
    },
    syncStatus: {
      type: 'text',
      sqlName: 'sync_status',
      notNull: true,
      defaultValue: 'pending',
      enumValues: ['pending', 'synced', 'conflict'] as const
    },
    deleted: {
      type: 'boolean',
      sqlName: 'deleted',
      notNull: true,
      defaultValue: false
    }
  },
  indexes: [
    { name: 'entity_idx', columns: ['entityType', 'entityId'] },
    { name: 'sync_status_idx', columns: ['syncStatus'] }
  ]
};

/**
 * User settings table for storing encrypted user preferences.
 */
export const userSettingsTable: TableDefinition = {
  name: 'user_settings',
  propertyName: 'userSettings',
  comment: 'User settings table for storing encrypted user preferences.',
  columns: {
    key: {
      type: 'text',
      sqlName: 'key',
      primaryKey: true
    },
    value: {
      type: 'text',
      sqlName: 'value'
    },
    updatedAt: {
      type: 'timestamp',
      sqlName: 'updated_at',
      notNull: true
    }
  }
};

/**
 * Users table for core identity records.
 */
export const usersTable: TableDefinition = {
  name: 'users',
  propertyName: 'users',
  comment: 'Users table for core identity records.',
  columns: {
    id: {
      type: 'text',
      sqlName: 'id',
      primaryKey: true
    },
    email: {
      type: 'text',
      sqlName: 'email',
      notNull: true
    },
    emailConfirmed: {
      type: 'boolean',
      sqlName: 'email_confirmed',
      notNull: true,
      defaultValue: false
    },
    admin: {
      type: 'boolean',
      sqlName: 'admin',
      notNull: true,
      defaultValue: false
    },
    createdAt: {
      type: 'timestamp',
      sqlName: 'created_at'
    },
    updatedAt: {
      type: 'timestamp',
      sqlName: 'updated_at'
    },
    lastActiveAt: {
      type: 'timestamp',
      sqlName: 'last_active_at'
    }
  },
  indexes: [{ name: 'users_email_idx', columns: ['email'] }]
};

/**
 * Organizations table for grouping users and groups.
 */
export const organizationsTable: TableDefinition = {
  name: 'organizations',
  propertyName: 'organizations',
  comment: 'Organizations table for grouping users and groups.',
  columns: {
    id: {
      type: 'text',
      sqlName: 'id',
      primaryKey: true
    },
    name: {
      type: 'text',
      sqlName: 'name',
      notNull: true
    },
    description: {
      type: 'text',
      sqlName: 'description'
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
  indexes: [{ name: 'organizations_name_idx', columns: ['name'], unique: true }]
};

/**
 * Junction table for many-to-many relationship between users and organizations.
 */
export const userOrganizationsTable: TableDefinition = {
  name: 'user_organizations',
  propertyName: 'userOrganizations',
  comment:
    'Junction table for many-to-many relationship between users and organizations.',
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
    organizationId: {
      type: 'text',
      sqlName: 'organization_id',
      primaryKey: true,
      references: {
        table: 'organizations',
        column: 'id',
        onDelete: 'cascade'
      }
    },
    joinedAt: {
      type: 'timestamp',
      sqlName: 'joined_at',
      notNull: true
    },
    isAdmin: {
      type: 'boolean',
      sqlName: 'is_admin',
      notNull: true,
      defaultValue: false
    }
  },
  indexes: [{ name: 'user_organizations_org_idx', columns: ['organizationId'] }]
};

/**
 * User credentials table for password authentication.
 */
export const userCredentialsTable: TableDefinition = {
  name: 'user_credentials',
  propertyName: 'userCredentials',
  comment: 'User credentials table for password authentication.',
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
    passwordHash: {
      type: 'text',
      sqlName: 'password_hash',
      notNull: true
    },
    passwordSalt: {
      type: 'text',
      sqlName: 'password_salt',
      notNull: true
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
  }
};

/**
 * Migrations table to track applied database migrations.
 */
export const migrationsTable: TableDefinition = {
  name: 'schema_migrations',
  propertyName: 'migrations',
  comment: 'Migrations table to track applied database migrations.',
  columns: {
    version: {
      type: 'integer',
      sqlName: 'version',
      primaryKey: true
    },
    appliedAt: {
      type: 'timestamp',
      sqlName: 'applied_at',
      notNull: true
    }
  }
};

/**
 * Key-value store for encrypted secrets (tokens, credentials).
 */
export const secretsTable: TableDefinition = {
  name: 'secrets',
  propertyName: 'secrets',
  comment: 'Key-value store for encrypted secrets (tokens, credentials).',
  columns: {
    key: {
      type: 'text',
      sqlName: 'key',
      primaryKey: true
    },
    encryptedValue: {
      type: 'text',
      sqlName: 'encrypted_value',
      notNull: true
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
  }
};

/**
 * Files metadata table for tracking encrypted file storage in OPFS.
 */
export const filesTable: TableDefinition = {
  name: 'files',
  propertyName: 'files',
  comment: 'Files metadata table for tracking encrypted file storage in OPFS.',
  columns: {
    id: {
      type: 'text',
      sqlName: 'id',
      primaryKey: true
    },
    name: {
      type: 'text',
      sqlName: 'name',
      notNull: true
    },
    size: {
      type: 'integer',
      sqlName: 'size',
      notNull: true
    },
    mimeType: {
      type: 'text',
      sqlName: 'mime_type',
      notNull: true
    },
    uploadDate: {
      type: 'timestamp',
      sqlName: 'upload_date',
      notNull: true
    },
    contentHash: {
      type: 'text',
      sqlName: 'content_hash',
      notNull: true
    },
    storagePath: {
      type: 'text',
      sqlName: 'storage_path',
      notNull: true
    },
    thumbnailPath: {
      type: 'text',
      sqlName: 'thumbnail_path'
    },
    deleted: {
      type: 'boolean',
      sqlName: 'deleted',
      notNull: true,
      defaultValue: false
    }
  },
  indexes: [
    { name: 'files_content_hash_idx', columns: ['contentHash'] },
    { name: 'files_upload_date_idx', columns: ['uploadDate'] }
  ]
};

/**
 * Contacts table for storing contact information.
 */
export const contactsTable: TableDefinition = {
  name: 'contacts',
  propertyName: 'contacts',
  comment: 'Contacts table for storing contact information.',
  columns: {
    id: {
      type: 'text',
      sqlName: 'id',
      primaryKey: true
    },
    firstName: {
      type: 'text',
      sqlName: 'first_name',
      notNull: true
    },
    lastName: {
      type: 'text',
      sqlName: 'last_name'
    },
    birthday: {
      type: 'text',
      sqlName: 'birthday'
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
  indexes: [{ name: 'contacts_first_name_idx', columns: ['firstName'] }]
};

/**
 * Contact phone numbers (multiple per contact).
 */
export const contactPhonesTable: TableDefinition = {
  name: 'contact_phones',
  propertyName: 'contactPhones',
  comment: 'Contact phone numbers (multiple per contact).',
  columns: {
    id: {
      type: 'text',
      sqlName: 'id',
      primaryKey: true
    },
    contactId: {
      type: 'text',
      sqlName: 'contact_id',
      notNull: true
    },
    phoneNumber: {
      type: 'text',
      sqlName: 'phone_number',
      notNull: true
    },
    label: {
      type: 'text',
      sqlName: 'label'
    },
    isPrimary: {
      type: 'boolean',
      sqlName: 'is_primary',
      notNull: true,
      defaultValue: false
    }
  },
  indexes: [{ name: 'contact_phones_contact_idx', columns: ['contactId'] }]
};

/**
 * Contact email addresses (multiple per contact).
 */
export const contactEmailsTable: TableDefinition = {
  name: 'contact_emails',
  propertyName: 'contactEmails',
  comment: 'Contact email addresses (multiple per contact).',
  columns: {
    id: {
      type: 'text',
      sqlName: 'id',
      primaryKey: true
    },
    contactId: {
      type: 'text',
      sqlName: 'contact_id',
      notNull: true
    },
    email: {
      type: 'text',
      sqlName: 'email',
      notNull: true
    },
    label: {
      type: 'text',
      sqlName: 'label'
    },
    isPrimary: {
      type: 'boolean',
      sqlName: 'is_primary',
      notNull: true,
      defaultValue: false
    }
  },
  indexes: [
    { name: 'contact_emails_contact_idx', columns: ['contactId'] },
    { name: 'contact_emails_email_idx', columns: ['email'] }
  ]
};

/**
 * Analytics events table for tracking database operations.
 * Used for time series analysis of operation durations.
 */
export const analyticsEventsTable: TableDefinition = {
  name: 'analytics_events',
  propertyName: 'analyticsEvents',
  comment:
    'Analytics events table for tracking database operations.\nUsed for time series analysis of operation durations.',
  columns: {
    id: {
      type: 'text',
      sqlName: 'id',
      primaryKey: true
    },
    eventName: {
      type: 'text',
      sqlName: 'event_name',
      notNull: true
    },
    durationMs: {
      type: 'integer',
      sqlName: 'duration_ms',
      notNull: true
    },
    success: {
      type: 'boolean',
      sqlName: 'success',
      notNull: true
    },
    timestamp: {
      type: 'timestamp',
      sqlName: 'timestamp',
      notNull: true
    },
    detail: {
      type: 'json',
      sqlName: 'detail'
    }
  },
  indexes: [{ name: 'analytics_events_timestamp_idx', columns: ['timestamp'] }]
};

/**
 * Notes table for storing user notes with markdown content.
 */
export const notesTable: TableDefinition = {
  name: 'notes',
  propertyName: 'notes',
  comment: 'Notes table for storing user notes with markdown content.',
  columns: {
    id: {
      type: 'text',
      sqlName: 'id',
      primaryKey: true
    },
    title: {
      type: 'text',
      sqlName: 'title',
      notNull: true
    },
    content: {
      type: 'text',
      sqlName: 'content',
      notNull: true,
      defaultValue: ''
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
    { name: 'notes_updated_at_idx', columns: ['updatedAt'] },
    { name: 'notes_title_idx', columns: ['title'] }
  ]
};

/**
 * Groups table for organizing users into named groups.
 */
export const groupsTable: TableDefinition = {
  name: 'groups',
  propertyName: 'groups',
  comment: 'Groups table for organizing users into named groups.',
  columns: {
    id: {
      type: 'text',
      sqlName: 'id',
      primaryKey: true
    },
    organizationId: {
      type: 'text',
      sqlName: 'organization_id',
      notNull: true,
      references: {
        table: 'organizations',
        column: 'id',
        onDelete: 'cascade'
      }
    },
    name: {
      type: 'text',
      sqlName: 'name',
      notNull: true
    },
    description: {
      type: 'text',
      sqlName: 'description'
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
    {
      name: 'groups_org_name_idx',
      columns: ['organizationId', 'name'],
      unique: true
    },
    { name: 'groups_org_idx', columns: ['organizationId'] }
  ]
};

/**
 * Junction table for many-to-many relationship between users and groups.
 */
export const userGroupsTable: TableDefinition = {
  name: 'user_groups',
  propertyName: 'userGroups',
  comment:
    'Junction table for many-to-many relationship between users and groups.',
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
    groupId: {
      type: 'text',
      sqlName: 'group_id',
      primaryKey: true,
      references: {
        table: 'groups',
        column: 'id',
        onDelete: 'cascade'
      }
    },
    joinedAt: {
      type: 'timestamp',
      sqlName: 'joined_at',
      notNull: true
    }
  },
  indexes: [{ name: 'user_groups_group_idx', columns: ['groupId'] }]
};

// =============================================================================
// VFS (Virtual Filesystem) Tables
// =============================================================================
// Design Note: Cryptographic keys are stored as TEXT (base64-encoded) rather than
// BYTEA for the following reasons:
// 1. Cross-database compatibility: Works identically on PostgreSQL and SQLite
// 2. Human-readable in database tools for debugging and auditing
// 3. Simpler application layer: No bytea encoding/decoding required
// 4. Web API compatibility: Base64 is standard for transferring binary over JSON
// Base64 encoding adds ~33% overhead but keys are small and the benefits outweigh this.

/**
 * User cryptographic keys for VFS encryption and sharing.
 * Stores asymmetric keypairs (ML-KEM + X25519 hybrid) for key exchange.
 * All binary key data is base64-encoded before storage.
 */
export const userKeysTable: TableDefinition = {
  name: 'user_keys',
  propertyName: 'userKeys',
  comment:
    'User cryptographic keys for VFS encryption and sharing.\nStores asymmetric keypairs (ML-KEM + X25519 hybrid) for key exchange.',
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
    publicEncryptionKey: {
      type: 'text',
      sqlName: 'public_encryption_key',
      notNull: true
    },
    publicSigningKey: {
      type: 'text',
      sqlName: 'public_signing_key',
      notNull: true
    },
    encryptedPrivateKeys: {
      type: 'text',
      sqlName: 'encrypted_private_keys',
      notNull: true
    },
    argon2Salt: {
      type: 'text',
      sqlName: 'argon2_salt',
      notNull: true
    },
    recoveryKeyHash: {
      type: 'text',
      sqlName: 'recovery_key_hash'
    },
    createdAt: {
      type: 'timestamp',
      sqlName: 'created_at',
      notNull: true
    }
  }
};

/**
 * VFS registry - identity layer for all items that can participate in the hierarchy.
 * Every VFS item (folder, contact, photo, note, etc.) has an entry here.
 */
export const vfsRegistryTable: TableDefinition = {
  name: 'vfs_registry',
  propertyName: 'vfsRegistry',
  comment:
    'VFS registry - identity layer for all items that can participate in the hierarchy.\nEvery VFS item (folder, contact, photo, note, etc.) has an entry here.\nDevice-first: ownerId is optional and not FK-constrained to support offline creation.',
  columns: {
    id: {
      type: 'text',
      sqlName: 'id',
      primaryKey: true
    },
    objectType: {
      type: 'text',
      sqlName: 'object_type',
      notNull: true
    },
    ownerId: {
      type: 'text',
      sqlName: 'owner_id'
    },
    encryptedSessionKey: {
      type: 'text',
      sqlName: 'encrypted_session_key'
    },
    publicHierarchicalKey: {
      type: 'text',
      sqlName: 'public_hierarchical_key'
    },
    encryptedPrivateHierarchicalKey: {
      type: 'text',
      sqlName: 'encrypted_private_hierarchical_key'
    },
    createdAt: {
      type: 'timestamp',
      sqlName: 'created_at',
      notNull: true
    }
  },
  indexes: [
    { name: 'vfs_registry_owner_idx', columns: ['ownerId'] },
    { name: 'vfs_registry_type_idx', columns: ['objectType'] }
  ]
};

/**
 * VFS folders - extends registry for folder-type items.
 * Stores encrypted folder metadata.
 */
export const vfsFoldersTable: TableDefinition = {
  name: 'vfs_folders',
  propertyName: 'vfsFolders',
  comment:
    'VFS folders - extends registry for folder-type items.\nStores encrypted folder metadata.',
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
    icon: {
      type: 'text',
      sqlName: 'icon'
    },
    viewMode: {
      type: 'text',
      sqlName: 'view_mode'
    },
    defaultSort: {
      type: 'text',
      sqlName: 'default_sort'
    },
    sortDirection: {
      type: 'text',
      sqlName: 'sort_direction'
    }
  }
};

/**
 * VFS links - flexible parent/child relationships with per-link key wrapping.
 * Enables the same item to appear in multiple folders with different visibility.
 */
export const vfsLinksTable: TableDefinition = {
  name: 'vfs_links',
  propertyName: 'vfsLinks',
  comment:
    'VFS links - flexible parent/child relationships with per-link key wrapping.\nEnables the same item to appear in multiple folders with different visibility.',
  columns: {
    id: {
      type: 'text',
      sqlName: 'id',
      primaryKey: true
    },
    parentId: {
      type: 'text',
      sqlName: 'parent_id',
      notNull: true,
      references: {
        table: 'vfs_registry',
        column: 'id',
        onDelete: 'cascade'
      }
    },
    childId: {
      type: 'text',
      sqlName: 'child_id',
      notNull: true,
      references: {
        table: 'vfs_registry',
        column: 'id',
        onDelete: 'cascade'
      }
    },
    wrappedSessionKey: {
      type: 'text',
      sqlName: 'wrapped_session_key',
      notNull: true
    },
    wrappedHierarchicalKey: {
      type: 'text',
      sqlName: 'wrapped_hierarchical_key'
    },
    visibleChildren: {
      type: 'json',
      sqlName: 'visible_children'
    },
    position: {
      type: 'integer',
      sqlName: 'position'
    },
    createdAt: {
      type: 'timestamp',
      sqlName: 'created_at',
      notNull: true
    }
  },
  indexes: [
    { name: 'vfs_links_parent_idx', columns: ['parentId'] },
    { name: 'vfs_links_child_idx', columns: ['childId'] },
    {
      name: 'vfs_links_parent_child_idx',
      columns: ['parentId', 'childId'],
      unique: true
    }
  ]
};

/**
 * Playlists - extends registry for playlist-type items.
 * Stores encrypted playlist metadata.
 */
export const playlistsTable: TableDefinition = {
  name: 'playlists',
  propertyName: 'playlists',
  comment:
    'Playlists - extends registry for playlist-type items.\nStores encrypted playlist metadata.',
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
    encryptedDescription: {
      type: 'text',
      sqlName: 'encrypted_description'
    },
    coverImageId: {
      type: 'text',
      sqlName: 'cover_image_id',
      references: {
        table: 'vfs_registry',
        column: 'id',
        onDelete: 'set null'
      }
    },
    shuffleMode: {
      type: 'integer',
      sqlName: 'shuffle_mode',
      notNull: true,
      defaultValue: 0
    },
    mediaType: {
      type: 'text',
      sqlName: 'media_type',
      notNull: true,
      defaultValue: 'audio',
      enumValues: ['audio', 'video'] as const
    }
  }
};

/**
 * Albums - extends registry for album-type items.
 * Stores encrypted album metadata for photo collections.
 */
export const albumsTable: TableDefinition = {
  name: 'albums',
  propertyName: 'albums',
  comment:
    'Albums - extends registry for album-type items.\nStores encrypted album metadata for photo collections.',
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
    encryptedDescription: {
      type: 'text',
      sqlName: 'encrypted_description'
    },
    coverPhotoId: {
      type: 'text',
      sqlName: 'cover_photo_id',
      references: {
        table: 'vfs_registry',
        column: 'id',
        onDelete: 'set null'
      }
    }
  }
};

/**
 * Contact groups - extends registry for contactGroup-type items.
 * Stores encrypted contact group metadata.
 */
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
 * VFS shares - sharing items with users, groups, and organizations.
 * Supports permission levels and optional expiration dates.
 */
export const vfsSharesTable: TableDefinition = {
  name: 'vfs_shares',
  propertyName: 'vfsShares',
  comment:
    'VFS shares - sharing items with users, groups, and organizations.\nSupports permission levels and optional expiration dates.',
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
    shareType: {
      type: 'text',
      sqlName: 'share_type',
      notNull: true,
      enumValues: ['user', 'group', 'organization'] as const
    },
    targetId: {
      type: 'text',
      sqlName: 'target_id',
      notNull: true
    },
    permissionLevel: {
      type: 'text',
      sqlName: 'permission_level',
      notNull: true,
      enumValues: ['view', 'edit', 'download'] as const
    },
    wrappedSessionKey: {
      type: 'text',
      sqlName: 'wrapped_session_key'
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
    },
    expiresAt: {
      type: 'timestamp',
      sqlName: 'expires_at'
    }
  },
  indexes: [
    { name: 'vfs_shares_item_idx', columns: ['itemId'] },
    { name: 'vfs_shares_target_idx', columns: ['targetId'] },
    {
      name: 'vfs_shares_item_target_type_idx',
      columns: ['itemId', 'targetId', 'shareType'],
      unique: true
    },
    { name: 'vfs_shares_expires_idx', columns: ['expiresAt'] }
  ]
};

/**
 * Organization shares - sharing items between organizations.
 * Enables org-to-org sharing with permission levels and expiration.
 */
export const orgSharesTable: TableDefinition = {
  name: 'org_shares',
  propertyName: 'orgShares',
  comment:
    'Organization shares - sharing items between organizations.\nEnables org-to-org sharing with permission levels and expiration.',
  columns: {
    id: {
      type: 'text',
      sqlName: 'id',
      primaryKey: true
    },
    sourceOrgId: {
      type: 'text',
      sqlName: 'source_org_id',
      notNull: true,
      references: {
        table: 'organizations',
        column: 'id',
        onDelete: 'cascade'
      }
    },
    targetOrgId: {
      type: 'text',
      sqlName: 'target_org_id',
      notNull: true,
      references: {
        table: 'organizations',
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
    permissionLevel: {
      type: 'text',
      sqlName: 'permission_level',
      notNull: true,
      enumValues: ['view', 'edit', 'download'] as const
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
    },
    expiresAt: {
      type: 'timestamp',
      sqlName: 'expires_at'
    }
  },
  indexes: [
    { name: 'org_shares_item_idx', columns: ['itemId'] },
    { name: 'org_shares_source_idx', columns: ['sourceOrgId'] },
    { name: 'org_shares_target_idx', columns: ['targetOrgId'] },
    {
      name: 'org_shares_unique_idx',
      columns: ['sourceOrgId', 'targetOrgId', 'itemId'],
      unique: true
    }
  ]
};

/**
 * VFS access - direct access grants for sharing items with users.
 * Stores wrapped keys encrypted with user's public key.
 */
export const vfsAccessTable: TableDefinition = {
  name: 'vfs_access',
  propertyName: 'vfsAccess',
  comment:
    "VFS access - direct access grants for sharing items with users.\nStores wrapped keys encrypted with user's public key.",
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
    wrappedSessionKey: {
      type: 'text',
      sqlName: 'wrapped_session_key',
      notNull: true
    },
    wrappedHierarchicalKey: {
      type: 'text',
      sqlName: 'wrapped_hierarchical_key'
    },
    permissionLevel: {
      type: 'text',
      sqlName: 'permission_level',
      notNull: true,
      enumValues: ['read', 'write', 'admin'] as const
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
    grantedAt: {
      type: 'timestamp',
      sqlName: 'granted_at',
      notNull: true
    },
    expiresAt: {
      type: 'timestamp',
      sqlName: 'expires_at'
    }
  },
  indexes: [
    { name: 'vfs_access_user_idx', columns: ['userId'] },
    { name: 'vfs_access_item_idx', columns: ['itemId'] }
  ]
};

// =============================================================================
// MLS (RFC 9420) Encrypted Chat Tables
// =============================================================================
// Design Note: MLS implements end-to-end encryption where the server only stores
// ciphertext. All binary data (key packages, ciphertext, state) is base64-encoded.
// The X-Wing hybrid ciphersuite (ML-KEM + X25519) is used for post-quantum security.

/**
 * MLS key packages for user identity.
 * Users upload key packages that other users consume when adding them to groups.
 * Each key package can only be used once (consumed on group add).
 */
export const mlsKeyPackagesTable: TableDefinition = {
  name: 'mls_key_packages',
  propertyName: 'mlsKeyPackages',
  comment:
    'MLS key packages for user identity.\nEach package is consumed once when used to add user to a group.',
  columns: {
    id: {
      type: 'text',
      sqlName: 'id',
      primaryKey: true
    },
    userId: {
      type: 'text',
      sqlName: 'user_id',
      notNull: true,
      references: {
        table: 'users',
        column: 'id',
        onDelete: 'cascade'
      }
    },
    keyPackageData: {
      type: 'text',
      sqlName: 'key_package_data',
      notNull: true
    },
    keyPackageRef: {
      type: 'text',
      sqlName: 'key_package_ref',
      notNull: true
    },
    cipherSuite: {
      type: 'integer',
      sqlName: 'cipher_suite',
      notNull: true
    },
    createdAt: {
      type: 'timestamp',
      sqlName: 'created_at',
      notNull: true
    },
    consumedAt: {
      type: 'timestamp',
      sqlName: 'consumed_at'
    },
    consumedByGroupId: {
      type: 'text',
      sqlName: 'consumed_by_group_id'
    }
  },
  indexes: [
    { name: 'mls_key_packages_user_idx', columns: ['userId'] },
    {
      name: 'mls_key_packages_ref_idx',
      columns: ['keyPackageRef'],
      unique: true
    }
  ]
};

/**
 * MLS chat groups with epoch tracking for forward secrecy.
 * Groups manage cryptographic state and membership through MLS protocol.
 */
export const mlsGroupsTable: TableDefinition = {
  name: 'mls_groups',
  propertyName: 'mlsGroups',
  comment:
    'MLS chat groups with epoch tracking for forward secrecy.\nGroups manage cryptographic state and membership through MLS protocol.',
  columns: {
    id: {
      type: 'text',
      sqlName: 'id',
      primaryKey: true
    },
    groupIdMls: {
      type: 'text',
      sqlName: 'group_id_mls',
      notNull: true
    },
    name: {
      type: 'text',
      sqlName: 'name',
      notNull: true
    },
    description: {
      type: 'text',
      sqlName: 'description'
    },
    creatorUserId: {
      type: 'text',
      sqlName: 'creator_user_id',
      notNull: true,
      references: {
        table: 'users',
        column: 'id',
        onDelete: 'restrict'
      }
    },
    currentEpoch: {
      type: 'integer',
      sqlName: 'current_epoch',
      notNull: true,
      defaultValue: 0
    },
    cipherSuite: {
      type: 'integer',
      sqlName: 'cipher_suite',
      notNull: true
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
    {
      name: 'mls_groups_group_id_mls_idx',
      columns: ['groupIdMls'],
      unique: true
    },
    { name: 'mls_groups_creator_idx', columns: ['creatorUserId'] }
  ]
};

/**
 * MLS group membership tracking.
 * Tracks which users are members of which groups with their MLS leaf index.
 */
export const mlsGroupMembersTable: TableDefinition = {
  name: 'mls_group_members',
  propertyName: 'mlsGroupMembers',
  comment:
    'MLS group membership tracking.\nTracks which users are members of which groups with their MLS leaf index.',
  columns: {
    groupId: {
      type: 'text',
      sqlName: 'group_id',
      primaryKey: true,
      references: {
        table: 'mls_groups',
        column: 'id',
        onDelete: 'cascade'
      }
    },
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
    leafIndex: {
      type: 'integer',
      sqlName: 'leaf_index'
    },
    role: {
      type: 'text',
      sqlName: 'role',
      notNull: true,
      defaultValue: 'member',
      enumValues: ['admin', 'member'] as const
    },
    joinedAt: {
      type: 'timestamp',
      sqlName: 'joined_at',
      notNull: true
    },
    joinedAtEpoch: {
      type: 'integer',
      sqlName: 'joined_at_epoch',
      notNull: true
    },
    removedAt: {
      type: 'timestamp',
      sqlName: 'removed_at'
    }
  },
  indexes: [
    { name: 'mls_group_members_user_idx', columns: ['userId'] },
    { name: 'mls_group_members_active_idx', columns: ['groupId', 'removedAt'] }
  ]
};

/**
 * MLS encrypted messages.
 * Server stores ciphertext only - decryption happens client-side.
 */
export const mlsMessagesTable: TableDefinition = {
  name: 'mls_messages',
  propertyName: 'mlsMessages',
  comment:
    'MLS encrypted messages.\nServer stores ciphertext only - decryption happens client-side.',
  columns: {
    id: {
      type: 'text',
      sqlName: 'id',
      primaryKey: true
    },
    groupId: {
      type: 'text',
      sqlName: 'group_id',
      notNull: true,
      references: {
        table: 'mls_groups',
        column: 'id',
        onDelete: 'cascade'
      }
    },
    senderUserId: {
      type: 'text',
      sqlName: 'sender_user_id',
      references: {
        table: 'users',
        column: 'id',
        onDelete: 'set null'
      }
    },
    epoch: {
      type: 'integer',
      sqlName: 'epoch',
      notNull: true
    },
    ciphertext: {
      type: 'text',
      sqlName: 'ciphertext',
      notNull: true
    },
    messageType: {
      type: 'text',
      sqlName: 'message_type',
      notNull: true,
      enumValues: ['application', 'commit', 'proposal'] as const
    },
    contentType: {
      type: 'text',
      sqlName: 'content_type',
      defaultValue: 'text/plain'
    },
    sequenceNumber: {
      type: 'integer',
      sqlName: 'sequence_number',
      notNull: true
    },
    createdAt: {
      type: 'timestamp',
      sqlName: 'created_at',
      notNull: true
    }
  },
  indexes: [
    {
      name: 'mls_messages_group_seq_unique',
      columns: ['groupId', 'sequenceNumber'],
      unique: true
    },
    { name: 'mls_messages_group_epoch_idx', columns: ['groupId', 'epoch'] },
    { name: 'mls_messages_created_idx', columns: ['createdAt'] }
  ]
};

/**
 * MLS welcome messages for new group members.
 * When a user is added to a group, they receive a welcome message
 * that contains the encrypted group state needed to join.
 */
export const mlsWelcomeMessagesTable: TableDefinition = {
  name: 'mls_welcome_messages',
  propertyName: 'mlsWelcomeMessages',
  comment:
    'MLS welcome messages for new group members.\nContains encrypted group state needed to join.',
  columns: {
    id: {
      type: 'text',
      sqlName: 'id',
      primaryKey: true
    },
    groupId: {
      type: 'text',
      sqlName: 'group_id',
      notNull: true,
      references: {
        table: 'mls_groups',
        column: 'id',
        onDelete: 'cascade'
      }
    },
    recipientUserId: {
      type: 'text',
      sqlName: 'recipient_user_id',
      notNull: true,
      references: {
        table: 'users',
        column: 'id',
        onDelete: 'cascade'
      }
    },
    keyPackageRef: {
      type: 'text',
      sqlName: 'key_package_ref',
      notNull: true
    },
    welcomeData: {
      type: 'text',
      sqlName: 'welcome_data',
      notNull: true
    },
    epoch: {
      type: 'integer',
      sqlName: 'epoch',
      notNull: true
    },
    createdAt: {
      type: 'timestamp',
      sqlName: 'created_at',
      notNull: true
    },
    consumedAt: {
      type: 'timestamp',
      sqlName: 'consumed_at'
    }
  },
  indexes: [
    {
      name: 'mls_welcome_recipient_idx',
      columns: ['recipientUserId', 'consumedAt']
    },
    { name: 'mls_welcome_group_idx', columns: ['groupId'] }
  ]
};

/**
 * MLS group state snapshots for recovery and multi-device sync.
 * Stores encrypted serialized MLS state at specific epochs.
 * State is encrypted client-side before upload.
 */
export const mlsGroupStateTable: TableDefinition = {
  name: 'mls_group_state',
  propertyName: 'mlsGroupState',
  comment:
    'MLS group state snapshots for recovery and multi-device sync.\nStores encrypted serialized MLS state at specific epochs.',
  columns: {
    id: {
      type: 'text',
      sqlName: 'id',
      primaryKey: true
    },
    groupId: {
      type: 'text',
      sqlName: 'group_id',
      notNull: true,
      references: {
        table: 'mls_groups',
        column: 'id',
        onDelete: 'cascade'
      }
    },
    userId: {
      type: 'text',
      sqlName: 'user_id',
      notNull: true,
      references: {
        table: 'users',
        column: 'id',
        onDelete: 'cascade'
      }
    },
    epoch: {
      type: 'integer',
      sqlName: 'epoch',
      notNull: true
    },
    encryptedState: {
      type: 'text',
      sqlName: 'encrypted_state',
      notNull: true
    },
    stateHash: {
      type: 'text',
      sqlName: 'state_hash',
      notNull: true
    },
    createdAt: {
      type: 'timestamp',
      sqlName: 'created_at',
      notNull: true
    }
  },
  indexes: [
    {
      name: 'mls_group_state_user_group_unique',
      columns: ['groupId', 'userId'],
      unique: true
    },
    { name: 'mls_group_state_epoch_idx', columns: ['groupId', 'epoch'] }
  ]
};

// =============================================================================
// AI Conversation & Usage Tables
// =============================================================================
// Design Note: Messages are encrypted client-side following the VFS pattern.
// Usage data (token counts) is stored in plaintext for billing/analytics.

/**
 * AI conversations - stores encrypted conversation metadata.
 * Each conversation belongs to a user and optionally an organization.
 */
export const aiConversationsTable: TableDefinition = {
  name: 'ai_conversations',
  propertyName: 'aiConversations',
  comment:
    'AI conversations - stores encrypted conversation metadata.\nEach conversation belongs to a user and optionally an organization.',
  columns: {
    id: {
      type: 'text',
      sqlName: 'id',
      primaryKey: true
    },
    userId: {
      type: 'text',
      sqlName: 'user_id',
      notNull: true,
      references: {
        table: 'users',
        column: 'id',
        onDelete: 'cascade'
      }
    },
    organizationId: {
      type: 'text',
      sqlName: 'organization_id',
      references: {
        table: 'organizations',
        column: 'id',
        onDelete: 'set null'
      }
    },
    encryptedTitle: {
      type: 'text',
      sqlName: 'encrypted_title',
      notNull: true
    },
    encryptedSessionKey: {
      type: 'text',
      sqlName: 'encrypted_session_key',
      notNull: true
    },
    modelId: {
      type: 'text',
      sqlName: 'model_id'
    },
    messageCount: {
      type: 'integer',
      sqlName: 'message_count',
      notNull: true,
      defaultValue: 0
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
    {
      name: 'ai_conversations_user_idx',
      columns: ['userId', 'deleted', 'updatedAt']
    },
    { name: 'ai_conversations_org_idx', columns: ['organizationId'] }
  ]
};

/**
 * AI messages - stores encrypted message content.
 * Messages are encrypted client-side before storage.
 */
export const aiMessagesTable: TableDefinition = {
  name: 'ai_messages',
  propertyName: 'aiMessages',
  comment:
    'AI messages - stores encrypted message content.\nMessages are encrypted client-side before storage.',
  columns: {
    id: {
      type: 'text',
      sqlName: 'id',
      primaryKey: true
    },
    conversationId: {
      type: 'text',
      sqlName: 'conversation_id',
      notNull: true,
      references: {
        table: 'ai_conversations',
        column: 'id',
        onDelete: 'cascade'
      }
    },
    role: {
      type: 'text',
      sqlName: 'role',
      notNull: true,
      enumValues: ['system', 'user', 'assistant'] as const
    },
    encryptedContent: {
      type: 'text',
      sqlName: 'encrypted_content',
      notNull: true
    },
    modelId: {
      type: 'text',
      sqlName: 'model_id'
    },
    sequenceNumber: {
      type: 'integer',
      sqlName: 'sequence_number',
      notNull: true
    },
    createdAt: {
      type: 'timestamp',
      sqlName: 'created_at',
      notNull: true
    }
  },
  indexes: [
    {
      name: 'ai_messages_conversation_idx',
      columns: ['conversationId', 'sequenceNumber']
    }
  ]
};

/**
 * AI usage - tracks token usage per request for billing/analytics.
 * Usage data is stored in plaintext (not encrypted) for aggregation.
 */
export const aiUsageTable: TableDefinition = {
  name: 'ai_usage',
  propertyName: 'aiUsage',
  comment:
    'AI usage - tracks token usage per request for billing/analytics.\nUsage data is stored in plaintext (not encrypted) for aggregation.',
  columns: {
    id: {
      type: 'text',
      sqlName: 'id',
      primaryKey: true
    },
    conversationId: {
      type: 'text',
      sqlName: 'conversation_id',
      references: {
        table: 'ai_conversations',
        column: 'id',
        onDelete: 'set null'
      }
    },
    messageId: {
      type: 'text',
      sqlName: 'message_id',
      references: {
        table: 'ai_messages',
        column: 'id',
        onDelete: 'set null'
      }
    },
    userId: {
      type: 'text',
      sqlName: 'user_id',
      notNull: true,
      references: {
        table: 'users',
        column: 'id',
        onDelete: 'cascade'
      }
    },
    organizationId: {
      type: 'text',
      sqlName: 'organization_id',
      references: {
        table: 'organizations',
        column: 'id',
        onDelete: 'set null'
      }
    },
    modelId: {
      type: 'text',
      sqlName: 'model_id',
      notNull: true
    },
    promptTokens: {
      type: 'integer',
      sqlName: 'prompt_tokens',
      notNull: true
    },
    completionTokens: {
      type: 'integer',
      sqlName: 'completion_tokens',
      notNull: true
    },
    totalTokens: {
      type: 'integer',
      sqlName: 'total_tokens',
      notNull: true
    },
    openrouterRequestId: {
      type: 'text',
      sqlName: 'openrouter_request_id'
    },
    createdAt: {
      type: 'timestamp',
      sqlName: 'created_at',
      notNull: true
    }
  },
  indexes: [
    { name: 'ai_usage_user_idx', columns: ['userId', 'createdAt'] },
    { name: 'ai_usage_org_idx', columns: ['organizationId', 'createdAt'] },
    { name: 'ai_usage_conversation_idx', columns: ['conversationId'] }
  ]
};

/**
 * All table definitions in the schema.
 */
export const allTables: TableDefinition[] = [
  syncMetadataTable,
  userSettingsTable,
  usersTable,
  organizationsTable,
  userOrganizationsTable,
  userCredentialsTable,
  migrationsTable,
  secretsTable,
  filesTable,
  contactsTable,
  contactPhonesTable,
  contactEmailsTable,
  analyticsEventsTable,
  notesTable,
  groupsTable,
  userGroupsTable,
  // VFS tables
  userKeysTable,
  vfsRegistryTable,
  vfsFoldersTable,
  vfsLinksTable,
  playlistsTable,
  albumsTable,
  contactGroupsTable,
  emailFoldersTable,
  tagsTable,
  emailsTable,
  composedEmailsTable,
  emailAttachmentsTable,
  vfsSharesTable,
  orgSharesTable,
  vfsAccessTable,
  // MLS tables
  mlsKeyPackagesTable,
  mlsGroupsTable,
  mlsGroupMembersTable,
  mlsMessagesTable,
  mlsWelcomeMessagesTable,
  mlsGroupStateTable,
  // AI tables
  aiConversationsTable,
  aiMessagesTable,
  aiUsageTable
];

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
  vfsAccessTable
];

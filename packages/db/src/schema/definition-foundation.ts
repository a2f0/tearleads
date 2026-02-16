import type { TableDefinition } from './types.js';
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
    personalOrganizationId: {
      type: 'text',
      sqlName: 'personal_organization_id',
      notNull: true,
      references: {
        table: 'organizations',
        column: 'id',
        onDelete: 'restrict'
      }
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
    },
    disabled: {
      type: 'boolean',
      sqlName: 'disabled',
      notNull: true,
      defaultValue: false
    },
    disabledAt: {
      type: 'timestamp',
      sqlName: 'disabled_at'
    },
    disabledBy: {
      type: 'text',
      sqlName: 'disabled_by',
      references: { table: 'users', column: 'id' }
    },
    markedForDeletionAt: {
      type: 'timestamp',
      sqlName: 'marked_for_deletion_at'
    },
    markedForDeletionBy: {
      type: 'text',
      sqlName: 'marked_for_deletion_by',
      references: { table: 'users', column: 'id' }
    }
  },
  indexes: [
    { name: 'users_email_idx', columns: ['email'] },
    {
      name: 'users_personal_organization_id_idx',
      columns: ['personalOrganizationId'],
      unique: true
    }
  ]
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
    isPersonal: {
      type: 'boolean',
      sqlName: 'is_personal',
      notNull: true,
      defaultValue: false
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
    { name: 'organizations_name_idx', columns: ['name'], unique: true },
    { name: 'organizations_is_personal_idx', columns: ['isPersonal'] }
  ]
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
 * Organization billing accounts for RevenueCat integration.
 * Stores one billing account record per organization.
 */
// COMPLIANCE_SENTINEL: TL-PAY-005 | control=billing-data-authorization
// COMPLIANCE_SENTINEL: TL-PAY-006 | control=entitlement-state-integrity
export const organizationBillingAccountsTable: TableDefinition = {
  name: 'organization_billing_accounts',
  propertyName: 'organizationBillingAccounts',
  comment:
    'Organization billing accounts for RevenueCat integration.\nStores one billing account record per organization.',
  columns: {
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
    revenuecatAppUserId: {
      type: 'text',
      sqlName: 'revenuecat_app_user_id',
      notNull: true
    },
    entitlementStatus: {
      type: 'text',
      sqlName: 'entitlement_status',
      notNull: true,
      defaultValue: 'inactive',
      enumValues: [
        'inactive',
        'trialing',
        'active',
        'grace_period',
        'expired'
      ] as const
    },
    activeProductId: {
      type: 'text',
      sqlName: 'active_product_id'
    },
    periodEndsAt: {
      type: 'timestamp',
      sqlName: 'period_ends_at'
    },
    willRenew: {
      type: 'boolean',
      sqlName: 'will_renew'
    },
    lastWebhookEventId: {
      type: 'text',
      sqlName: 'last_webhook_event_id'
    },
    lastWebhookAt: {
      type: 'timestamp',
      sqlName: 'last_webhook_at'
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
      name: 'organization_billing_app_user_idx',
      columns: ['revenuecatAppUserId'],
      unique: true
    },
    {
      name: 'organization_billing_entitlement_idx',
      columns: ['entitlementStatus']
    },
    {
      name: 'organization_billing_period_end_idx',
      columns: ['periodEndsAt']
    }
  ]
};

/**
 * RevenueCat webhook event archive and processing state.
 * Supports idempotent processing by unique event ID.
 */
// COMPLIANCE_SENTINEL: TL-PAY-003 | control=idempotent-event-processing
// COMPLIANCE_SENTINEL: TL-PAY-004 | control=billing-event-audit-trail
export const revenuecatWebhookEventsTable: TableDefinition = {
  name: 'revenuecat_webhook_events',
  propertyName: 'revenuecatWebhookEvents',
  comment:
    'RevenueCat webhook event archive and processing state.\nSupports idempotent processing by unique event ID.',
  columns: {
    id: {
      type: 'text',
      sqlName: 'id',
      primaryKey: true
    },
    eventId: {
      type: 'text',
      sqlName: 'event_id',
      notNull: true
    },
    eventType: {
      type: 'text',
      sqlName: 'event_type',
      notNull: true
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
    revenuecatAppUserId: {
      type: 'text',
      sqlName: 'revenuecat_app_user_id',
      notNull: true
    },
    payload: {
      type: 'json',
      sqlName: 'payload',
      notNull: true
    },
    receivedAt: {
      type: 'timestamp',
      sqlName: 'received_at',
      notNull: true
    },
    processedAt: {
      type: 'timestamp',
      sqlName: 'processed_at'
    },
    processingError: {
      type: 'text',
      sqlName: 'processing_error'
    }
  },
  indexes: [
    {
      name: 'revenuecat_events_event_id_idx',
      columns: ['eventId'],
      unique: true
    },
    {
      name: 'revenuecat_events_org_idx',
      columns: ['organizationId']
    },
    {
      name: 'revenuecat_events_app_user_idx',
      columns: ['revenuecatAppUserId']
    },
    {
      name: 'revenuecat_events_received_idx',
      columns: ['receivedAt']
    }
  ]
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
 * Vehicles table for storing vehicle inventory metadata.
 */
export const vehiclesTable: TableDefinition = {
  name: 'vehicles',
  propertyName: 'vehicles',
  comment: 'Vehicles table for storing vehicle inventory metadata.',
  columns: {
    id: {
      type: 'text',
      sqlName: 'id',
      primaryKey: true
    },
    make: {
      type: 'text',
      sqlName: 'make',
      notNull: true
    },
    model: {
      type: 'text',
      sqlName: 'model',
      notNull: true
    },
    year: {
      type: 'integer',
      sqlName: 'year'
    },
    color: {
      type: 'text',
      sqlName: 'color'
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
    { name: 'vehicles_updated_at_idx', columns: ['updatedAt'] },
    { name: 'vehicles_make_model_idx', columns: ['make', 'model'] },
    { name: 'vehicles_year_idx', columns: ['year'] },
    { name: 'vehicles_deleted_idx', columns: ['deleted'] }
  ]
};

/**
 * Health exercises table for workout exercise selection.
 * Supports hierarchical exercise categories via parentId (e.g., Pull-Up -> Wide Grip Pull-Up).
 */
export const healthExercisesTable: TableDefinition = {
  name: 'health_exercises',
  propertyName: 'healthExercises',
  comment:
    'Health exercises table for workout exercise selection.\nSupports hierarchical exercise categories via parentId.',
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
    parentId: {
      type: 'text',
      sqlName: 'parent_id',
      references: {
        table: 'health_exercises',
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
    { name: 'health_exercises_name_idx', columns: ['name'] },
    { name: 'health_exercises_parent_idx', columns: ['parentId'] }
  ]
};

/**
 * Health weight readings table for storing body weight measurements.
 * Values are stored as centi-units to preserve decimal precision.
 */

export const foundationTables: TableDefinition[] = [
  syncMetadataTable,
  userSettingsTable,
  usersTable,
  organizationsTable,
  userOrganizationsTable,
  organizationBillingAccountsTable,
  revenuecatWebhookEventsTable,
  userCredentialsTable,
  migrationsTable,
  secretsTable,
  filesTable,
  contactsTable,
  contactPhonesTable,
  contactEmailsTable,
  analyticsEventsTable,
  notesTable,
  vehiclesTable,
  healthExercisesTable
];

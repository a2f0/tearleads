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
 * All table definitions in the schema.
 */
export const allTables: TableDefinition[] = [
  syncMetadataTable,
  userSettingsTable,
  migrationsTable,
  secretsTable,
  filesTable,
  contactsTable,
  contactPhonesTable,
  contactEmailsTable,
  analyticsEventsTable,
  notesTable
];

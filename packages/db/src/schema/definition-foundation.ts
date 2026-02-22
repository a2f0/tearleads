import type { TableDefinition } from './types.js';

export {
  contactEmailsTable,
  contactPhonesTable,
  contactsTable
} from './definition-foundation-contacts.js';
// Re-export from split modules
export {
  organizationBillingAccountsTable,
  organizationsTable,
  revenuecatWebhookEventsTable,
  userCredentialsTable,
  userOrganizationsTable,
  usersTable
} from './definition-foundation-users.js';

import { foundationContactsTables } from './definition-foundation-contacts.js';
// Import for combining into foundationTables
import { foundationUsersTables } from './definition-foundation-users.js';

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

export const foundationTables: TableDefinition[] = [
  syncMetadataTable,
  userSettingsTable,
  ...foundationUsersTables,
  migrationsTable,
  secretsTable,
  filesTable,
  ...foundationContactsTables,
  analyticsEventsTable,
  notesTable,
  vehiclesTable,
  healthExercisesTable
];

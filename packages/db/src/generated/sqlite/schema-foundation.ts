import {
  type AnySQLiteColumn,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex
} from 'drizzle-orm/sqlite-core';

export const syncMetadata = sqliteTable(
  'sync_metadata',
  {
    id: text('id').primaryKey(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    version: integer('version').notNull().default(0),
    lastModified: integer('last_modified', { mode: 'timestamp_ms' }).notNull(),
    syncStatus: text('sync_status', {
      enum: ['pending', 'synced', 'conflict']
    })
      .notNull()
      .default('pending'),
    deleted: integer('deleted', { mode: 'boolean' }).notNull().default(false)
  },
  (table) => [
    index('entity_idx').on(table.entityType, table.entityId),
    index('sync_status_idx').on(table.syncStatus)
  ]
);

/**
 * User settings table for storing encrypted user preferences.
 */
export const userSettings = sqliteTable('user_settings', {
  key: text('key').primaryKey(),
  value: text('value'),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
});

/**
 * Users table for core identity records.
 */
export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    emailConfirmed: integer('email_confirmed', { mode: 'boolean' })
      .notNull()
      .default(false),
    admin: integer('admin', { mode: 'boolean' }).notNull().default(false),
    personalOrganizationId: text('personal_organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }),
    lastActiveAt: integer('last_active_at', { mode: 'timestamp_ms' }),
    disabled: integer('disabled', { mode: 'boolean' }).notNull().default(false),
    disabledAt: integer('disabled_at', { mode: 'timestamp_ms' }),
    disabledBy: text('disabled_by').references((): AnySQLiteColumn => users.id),
    markedForDeletionAt: integer('marked_for_deletion_at', {
      mode: 'timestamp_ms'
    }),
    markedForDeletionBy: text('marked_for_deletion_by').references(
      (): AnySQLiteColumn => users.id
    )
  },
  (table) => [
    index('users_email_idx').on(table.email),
    uniqueIndex('users_personal_organization_id_idx').on(
      table.personalOrganizationId
    )
  ]
);

/**
 * Organizations table for grouping users and groups.
 */
export const organizations = sqliteTable(
  'organizations',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description'),
    isPersonal: integer('is_personal', { mode: 'boolean' })
      .notNull()
      .default(false),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
  },
  (table) => [
    uniqueIndex('organizations_name_idx').on(table.name),
    index('organizations_is_personal_idx').on(table.isPersonal)
  ]
);

/**
 * Junction table for many-to-many relationship between users and organizations.
 */
export const userOrganizations = sqliteTable(
  'user_organizations',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    joinedAt: integer('joined_at', { mode: 'timestamp_ms' }).notNull(),
    isAdmin: integer('is_admin', { mode: 'boolean' }).notNull().default(false)
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.organizationId] }),
    index('user_organizations_org_idx').on(table.organizationId)
  ]
);

/**
 * Organization billing accounts for RevenueCat integration.
 * Stores one billing account record per organization.
 */
export const organizationBillingAccounts = sqliteTable(
  'organization_billing_accounts',
  {
    organizationId: text('organization_id')
      .primaryKey()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    revenuecatAppUserId: text('revenuecat_app_user_id').notNull(),
    entitlementStatus: text('entitlement_status', {
      enum: ['inactive', 'trialing', 'active', 'grace_period', 'expired']
    })
      .notNull()
      .default('inactive'),
    activeProductId: text('active_product_id'),
    periodEndsAt: integer('period_ends_at', { mode: 'timestamp_ms' }),
    willRenew: integer('will_renew', { mode: 'boolean' }),
    lastWebhookEventId: text('last_webhook_event_id'),
    lastWebhookAt: integer('last_webhook_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
  },
  (table) => [
    uniqueIndex('organization_billing_app_user_idx').on(
      table.revenuecatAppUserId
    ),
    index('organization_billing_entitlement_idx').on(table.entitlementStatus),
    index('organization_billing_period_end_idx').on(table.periodEndsAt)
  ]
);

/**
 * RevenueCat webhook event archive and processing state.
 * Supports idempotent processing by unique event ID.
 */
export const revenuecatWebhookEvents = sqliteTable(
  'revenuecat_webhook_events',
  {
    id: text('id').primaryKey(),
    eventId: text('event_id').notNull(),
    eventType: text('event_type').notNull(),
    organizationId: text('organization_id').references(() => organizations.id, {
      onDelete: 'set null'
    }),
    revenuecatAppUserId: text('revenuecat_app_user_id').notNull(),
    payload: text('payload').notNull(),
    receivedAt: integer('received_at', { mode: 'timestamp_ms' }).notNull(),
    processedAt: integer('processed_at', { mode: 'timestamp_ms' }),
    processingError: text('processing_error')
  },
  (table) => [
    uniqueIndex('revenuecat_events_event_id_idx').on(table.eventId),
    index('revenuecat_events_org_idx').on(table.organizationId),
    index('revenuecat_events_app_user_idx').on(table.revenuecatAppUserId),
    index('revenuecat_events_received_idx').on(table.receivedAt)
  ]
);

/**
 * User credentials table for password authentication.
 */
export const userCredentials = sqliteTable('user_credentials', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  passwordHash: text('password_hash').notNull(),
  passwordSalt: text('password_salt').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
});

/**
 * Migrations table to track applied database migrations.
 */
export const migrations = sqliteTable('schema_migrations', {
  version: integer('version').primaryKey(),
  appliedAt: integer('applied_at', { mode: 'timestamp_ms' }).notNull()
});

/**
 * Key-value store for encrypted secrets (tokens, credentials).
 */
export const secrets = sqliteTable('secrets', {
  key: text('key').primaryKey(),
  encryptedValue: text('encrypted_value').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
});

/**
 * Files metadata table for tracking encrypted file storage in OPFS.
 */
export const files = sqliteTable(
  'files',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    size: integer('size').notNull(),
    mimeType: text('mime_type').notNull(),
    uploadDate: integer('upload_date', { mode: 'timestamp_ms' }).notNull(),
    contentHash: text('content_hash').notNull(),
    storagePath: text('storage_path').notNull(),
    thumbnailPath: text('thumbnail_path'),
    deleted: integer('deleted', { mode: 'boolean' }).notNull().default(false)
  },
  (table) => [
    index('files_content_hash_idx').on(table.contentHash),
    index('files_upload_date_idx').on(table.uploadDate)
  ]
);

/**
 * Contacts table for storing contact information.
 */
export const contacts = sqliteTable(
  'contacts',
  {
    id: text('id').primaryKey(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name'),
    birthday: text('birthday'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
    deleted: integer('deleted', { mode: 'boolean' }).notNull().default(false)
  },
  (table) => [index('contacts_first_name_idx').on(table.firstName)]
);

/**
 * Contact phone numbers (multiple per contact).
 */
export const contactPhones = sqliteTable(
  'contact_phones',
  {
    id: text('id').primaryKey(),
    contactId: text('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    phoneNumber: text('phone_number').notNull(),
    label: text('label'),
    isPrimary: integer('is_primary', { mode: 'boolean' })
      .notNull()
      .default(false)
  },
  (table) => [index('contact_phones_contact_idx').on(table.contactId)]
);

/**
 * Contact email addresses (multiple per contact).
 */
export const contactEmails = sqliteTable(
  'contact_emails',
  {
    id: text('id').primaryKey(),
    contactId: text('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    label: text('label'),
    isPrimary: integer('is_primary', { mode: 'boolean' })
      .notNull()
      .default(false)
  },
  (table) => [
    index('contact_emails_contact_idx').on(table.contactId),
    index('contact_emails_email_idx').on(table.email)
  ]
);

/**
 * Analytics events table for tracking database operations.
 * Used for time series analysis of operation durations.
 */
export const analyticsEvents = sqliteTable(
  'analytics_events',
  {
    id: text('id').primaryKey(),
    eventName: text('event_name').notNull(),
    durationMs: integer('duration_ms').notNull(),
    success: integer('success', { mode: 'boolean' }).notNull(),
    timestamp: integer('timestamp', { mode: 'timestamp_ms' }).notNull(),
    detail: text('detail')
  },
  (table) => [index('analytics_events_timestamp_idx').on(table.timestamp)]
);

/**
 * Notes table for storing user notes with markdown content.
 */
export const notes = sqliteTable(
  'notes',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    content: text('content').notNull().default(''),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
    deleted: integer('deleted', { mode: 'boolean' }).notNull().default(false)
  },
  (table) => [
    index('notes_updated_at_idx').on(table.updatedAt),
    index('notes_title_idx').on(table.title)
  ]
);

/**
 * Vehicles table for storing vehicle inventory metadata.
 */
export const vehicles = sqliteTable(
  'vehicles',
  {
    id: text('id').primaryKey(),
    make: text('make').notNull(),
    model: text('model').notNull(),
    year: integer('year'),
    color: text('color'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
    deleted: integer('deleted', { mode: 'boolean' }).notNull().default(false)
  },
  (table) => [
    index('vehicles_updated_at_idx').on(table.updatedAt),
    index('vehicles_make_model_idx').on(table.make, table.model),
    index('vehicles_year_idx').on(table.year),
    index('vehicles_deleted_idx').on(table.deleted)
  ]
);

/**
 * Health exercises table for workout exercise selection.
 * Supports hierarchical exercise categories via parentId.
 */
export const healthExercises = sqliteTable(
  'health_exercises',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    parentId: text('parent_id').references(
      (): AnySQLiteColumn => healthExercises.id,
      { onDelete: 'restrict' }
    ),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
  },
  (table) => [
    index('health_exercises_name_idx').on(table.name),
    index('health_exercises_parent_idx').on(table.parentId)
  ]
);

/**
 * Health weight readings table for storing body weight measurements.
 * Values are stored as centi-units to preserve decimal precision.
 */
export const healthWeightReadings = sqliteTable(
  'health_weight_readings',
  {
    id: text('id').primaryKey(),
    recordedAt: integer('recorded_at', { mode: 'timestamp_ms' }).notNull(),
    valueCenti: integer('value_centi').notNull(),
    unit: text('unit', {
      enum: ['lb', 'kg']
    })
      .notNull()
      .default('lb'),
    note: text('note'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
  },
  (table) => [
    index('health_weight_readings_recorded_at_idx').on(table.recordedAt)
  ]
);

/**
 * Health blood pressure readings table for systolic/diastolic tracking.
 */
export const healthBloodPressureReadings = sqliteTable(
  'health_blood_pressure_readings',
  {
    id: text('id').primaryKey(),
    recordedAt: integer('recorded_at', { mode: 'timestamp_ms' }).notNull(),
    systolic: integer('systolic').notNull(),
    diastolic: integer('diastolic').notNull(),
    pulse: integer('pulse'),
    note: text('note'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
  },
  (table) => [
    index('health_blood_pressure_recorded_at_idx').on(table.recordedAt)
  ]
);

/**
 * Health workout entries table for exercise, reps, and weight tracking.
 * Weight values are stored as centi-units to preserve decimal precision.
 */
export const healthWorkoutEntries = sqliteTable(
  'health_workout_entries',
  {
    id: text('id').primaryKey(),
    performedAt: integer('performed_at', { mode: 'timestamp_ms' }).notNull(),
    exerciseId: text('exercise_id')
      .notNull()
      .references(() => healthExercises.id, { onDelete: 'restrict' }),
    reps: integer('reps').notNull(),
    weightCenti: integer('weight_centi').notNull(),
    weightUnit: text('weight_unit', {
      enum: ['lb', 'kg']
    })
      .notNull()
      .default('lb'),
    note: text('note'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
  },
  (table) => [
    index('health_workout_entries_performed_at_idx').on(table.performedAt),
    index('health_workout_entries_exercise_idx').on(table.exerciseId)
  ]
);

/**
 * Groups table for organizing users into named groups.
 */
export const groups = sqliteTable(
  'groups',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
  },
  (table) => [
    uniqueIndex('groups_org_name_idx').on(table.organizationId, table.name),
    index('groups_org_idx').on(table.organizationId)
  ]
);

/**
 * Junction table for many-to-many relationship between users and groups.
 */
export const userGroups = sqliteTable(
  'user_groups',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    joinedAt: integer('joined_at', { mode: 'timestamp_ms' }).notNull()
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.groupId] }),
    index('user_groups_group_idx').on(table.groupId)
  ]
);

/**
 * User cryptographic keys for VFS encryption and sharing.
 * Stores asymmetric keypairs (ML-KEM + X25519 hybrid) for key exchange.
 */

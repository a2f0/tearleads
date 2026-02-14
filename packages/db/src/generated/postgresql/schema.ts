import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex
} from 'drizzle-orm/pg-core';

/**
 * Sync metadata table for tracking entity sync status.
 * Designed for future cloud sync capabilities.
 */
export const syncMetadata = pgTable(
  'sync_metadata',
  {
    id: text('id').primaryKey(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    version: integer('version').notNull().default(0),
    lastModified: timestamp('last_modified', { withTimezone: true }).notNull(),
    syncStatus: text('sync_status', {
      enum: ['pending', 'synced', 'conflict']
    })
      .notNull()
      .default('pending'),
    deleted: boolean('deleted').notNull().default(false)
  },
  (table) => [
    index('entity_idx').on(table.entityType, table.entityId),
    index('sync_status_idx').on(table.syncStatus)
  ]
);

/**
 * User settings table for storing encrypted user preferences.
 */
export const userSettings = pgTable('user_settings', {
  key: text('key').primaryKey(),
  value: text('value'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull()
});

/**
 * Users table for core identity records.
 */
export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    emailConfirmed: boolean('email_confirmed').notNull().default(false),
    admin: boolean('admin').notNull().default(false),
    personalOrganizationId: text('personal_organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
    lastActiveAt: timestamp('last_active_at', { withTimezone: true }),
    disabled: boolean('disabled').notNull().default(false),
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
    disabledBy: text('disabled_by').references((): AnyPgColumn => users.id),
    markedForDeletionAt: timestamp('marked_for_deletion_at', {
      withTimezone: true
    }),
    markedForDeletionBy: text('marked_for_deletion_by').references(
      (): AnyPgColumn => users.id
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
export const organizations = pgTable(
  'organizations',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description'),
    isPersonal: boolean('is_personal').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull()
  },
  (table) => [
    uniqueIndex('organizations_name_idx').on(table.name),
    index('organizations_is_personal_idx').on(table.isPersonal)
  ]
);

/**
 * Junction table for many-to-many relationship between users and organizations.
 */
export const userOrganizations = pgTable(
  'user_organizations',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull(),
    isAdmin: boolean('is_admin').notNull().default(false)
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
export const organizationBillingAccounts = pgTable(
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
    periodEndsAt: timestamp('period_ends_at', { withTimezone: true }),
    willRenew: boolean('will_renew'),
    lastWebhookEventId: text('last_webhook_event_id'),
    lastWebhookAt: timestamp('last_webhook_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull()
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
export const revenuecatWebhookEvents = pgTable(
  'revenuecat_webhook_events',
  {
    id: text('id').primaryKey(),
    eventId: text('event_id').notNull(),
    eventType: text('event_type').notNull(),
    organizationId: text('organization_id').references(() => organizations.id, {
      onDelete: 'set null'
    }),
    revenuecatAppUserId: text('revenuecat_app_user_id').notNull(),
    payload: jsonb('payload').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
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
export const userCredentials = pgTable('user_credentials', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  passwordHash: text('password_hash').notNull(),
  passwordSalt: text('password_salt').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull()
});

/**
 * Migrations table to track applied database migrations.
 */
export const migrations = pgTable('schema_migrations', {
  version: integer('version').primaryKey(),
  appliedAt: timestamp('applied_at', { withTimezone: true }).notNull()
});

/**
 * Key-value store for encrypted secrets (tokens, credentials).
 */
export const secrets = pgTable('secrets', {
  key: text('key').primaryKey(),
  encryptedValue: text('encrypted_value').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull()
});

/**
 * Files metadata table for tracking encrypted file storage in OPFS.
 */
export const files = pgTable(
  'files',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    size: integer('size').notNull(),
    mimeType: text('mime_type').notNull(),
    uploadDate: timestamp('upload_date', { withTimezone: true }).notNull(),
    contentHash: text('content_hash').notNull(),
    storagePath: text('storage_path').notNull(),
    thumbnailPath: text('thumbnail_path'),
    deleted: boolean('deleted').notNull().default(false)
  },
  (table) => [
    index('files_content_hash_idx').on(table.contentHash),
    index('files_upload_date_idx').on(table.uploadDate)
  ]
);

/**
 * Contacts table for storing contact information.
 */
export const contacts = pgTable(
  'contacts',
  {
    id: text('id').primaryKey(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name'),
    birthday: text('birthday'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    deleted: boolean('deleted').notNull().default(false)
  },
  (table) => [index('contacts_first_name_idx').on(table.firstName)]
);

/**
 * Contact phone numbers (multiple per contact).
 */
export const contactPhones = pgTable(
  'contact_phones',
  {
    id: text('id').primaryKey(),
    contactId: text('contact_id').notNull(),
    phoneNumber: text('phone_number').notNull(),
    label: text('label'),
    isPrimary: boolean('is_primary').notNull().default(false)
  },
  (table) => [index('contact_phones_contact_idx').on(table.contactId)]
);

/**
 * Contact email addresses (multiple per contact).
 */
export const contactEmails = pgTable(
  'contact_emails',
  {
    id: text('id').primaryKey(),
    contactId: text('contact_id').notNull(),
    email: text('email').notNull(),
    label: text('label'),
    isPrimary: boolean('is_primary').notNull().default(false)
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
export const analyticsEvents = pgTable(
  'analytics_events',
  {
    id: text('id').primaryKey(),
    eventName: text('event_name').notNull(),
    durationMs: integer('duration_ms').notNull(),
    success: boolean('success').notNull(),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull(),
    detail: jsonb('detail')
  },
  (table) => [index('analytics_events_timestamp_idx').on(table.timestamp)]
);

/**
 * Notes table for storing user notes with markdown content.
 */
export const notes = pgTable(
  'notes',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    content: text('content').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    deleted: boolean('deleted').notNull().default(false)
  },
  (table) => [
    index('notes_updated_at_idx').on(table.updatedAt),
    index('notes_title_idx').on(table.title)
  ]
);

/**
 * Vehicles table for storing vehicle inventory metadata.
 */
export const vehicles = pgTable(
  'vehicles',
  {
    id: text('id').primaryKey(),
    make: text('make').notNull(),
    model: text('model').notNull(),
    year: integer('year'),
    color: text('color'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    deleted: boolean('deleted').notNull().default(false)
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
export const healthExercises = pgTable(
  'health_exercises',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    parentId: text('parent_id').references(
      (): AnyPgColumn => healthExercises.id,
      { onDelete: 'restrict' }
    ),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull()
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
export const healthWeightReadings = pgTable(
  'health_weight_readings',
  {
    id: text('id').primaryKey(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
    valueCenti: integer('value_centi').notNull(),
    unit: text('unit', {
      enum: ['lb', 'kg']
    })
      .notNull()
      .default('lb'),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull()
  },
  (table) => [
    index('health_weight_readings_recorded_at_idx').on(table.recordedAt)
  ]
);

/**
 * Health blood pressure readings table for systolic/diastolic tracking.
 */
export const healthBloodPressureReadings = pgTable(
  'health_blood_pressure_readings',
  {
    id: text('id').primaryKey(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
    systolic: integer('systolic').notNull(),
    diastolic: integer('diastolic').notNull(),
    pulse: integer('pulse'),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull()
  },
  (table) => [
    index('health_blood_pressure_recorded_at_idx').on(table.recordedAt)
  ]
);

/**
 * Health workout entries table for exercise, reps, and weight tracking.
 * Weight values are stored as centi-units to preserve decimal precision.
 */
export const healthWorkoutEntries = pgTable(
  'health_workout_entries',
  {
    id: text('id').primaryKey(),
    performedAt: timestamp('performed_at', { withTimezone: true }).notNull(),
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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull()
  },
  (table) => [
    index('health_workout_entries_performed_at_idx').on(table.performedAt),
    index('health_workout_entries_exercise_idx').on(table.exerciseId)
  ]
);

/**
 * Groups table for organizing users into named groups.
 */
export const groups = pgTable(
  'groups',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull()
  },
  (table) => [
    uniqueIndex('groups_org_name_idx').on(table.organizationId, table.name),
    index('groups_org_idx').on(table.organizationId)
  ]
);

/**
 * Junction table for many-to-many relationship between users and groups.
 */
export const userGroups = pgTable(
  'user_groups',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull()
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
export const userKeys = pgTable('user_keys', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  publicEncryptionKey: text('public_encryption_key').notNull(),
  publicSigningKey: text('public_signing_key').notNull(),
  encryptedPrivateKeys: text('encrypted_private_keys').notNull(),
  argon2Salt: text('argon2_salt').notNull(),
  recoveryKeyHash: text('recovery_key_hash'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull()
});

/**
 * VFS registry - identity layer for all items that can participate in the hierarchy.
 * Every VFS item (folder, contact, photo, note, etc.) has an entry here.
 * Device-first: ownerId is optional and not FK-constrained to support offline creation.
 */
export const vfsRegistry = pgTable(
  'vfs_registry',
  {
    id: text('id').primaryKey(),
    objectType: text('object_type').notNull(),
    ownerId: text('owner_id'),
    encryptedSessionKey: text('encrypted_session_key'),
    publicHierarchicalKey: text('public_hierarchical_key'),
    encryptedPrivateHierarchicalKey: text('encrypted_private_hierarchical_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull()
  },
  (table) => [
    index('vfs_registry_owner_idx').on(table.ownerId),
    index('vfs_registry_type_idx').on(table.objectType)
  ]
);

/**
 * VFS folders - extends registry for folder-type items.
 * Stores encrypted folder metadata.
 */
export const vfsFolders = pgTable('vfs_folders', {
  id: text('id')
    .primaryKey()
    .references(() => vfsRegistry.id, { onDelete: 'cascade' }),
  encryptedName: text('encrypted_name'),
  icon: text('icon'),
  viewMode: text('view_mode'),
  defaultSort: text('default_sort'),
  sortDirection: text('sort_direction')
});

/**
 * VFS links - flexible parent/child relationships with per-link key wrapping.
 * Enables the same item to appear in multiple folders with different visibility.
 */
export const vfsLinks = pgTable(
  'vfs_links',
  {
    id: text('id').primaryKey(),
    parentId: text('parent_id')
      .notNull()
      .references(() => vfsRegistry.id, { onDelete: 'cascade' }),
    childId: text('child_id')
      .notNull()
      .references(() => vfsRegistry.id, { onDelete: 'cascade' }),
    wrappedSessionKey: text('wrapped_session_key').notNull(),
    wrappedHierarchicalKey: text('wrapped_hierarchical_key'),
    visibleChildren: jsonb('visible_children'),
    position: integer('position'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull()
  },
  (table) => [
    index('vfs_links_parent_idx').on(table.parentId),
    index('vfs_links_child_idx').on(table.childId),
    uniqueIndex('vfs_links_parent_child_idx').on(table.parentId, table.childId)
  ]
);

/**
 * Playlists - extends registry for playlist-type items.
 * Stores encrypted playlist metadata.
 */
export const playlists = pgTable('playlists', {
  id: text('id')
    .primaryKey()
    .references(() => vfsRegistry.id, { onDelete: 'cascade' }),
  encryptedName: text('encrypted_name'),
  encryptedDescription: text('encrypted_description'),
  coverImageId: text('cover_image_id').references(() => vfsRegistry.id, {
    onDelete: 'set null'
  }),
  shuffleMode: integer('shuffle_mode').notNull().default(0),
  mediaType: text('media_type', {
    enum: ['audio', 'video']
  })
    .notNull()
    .default('audio')
});

/**
 * Albums - extends registry for album-type items.
 * Stores encrypted album metadata for photo collections.
 */
export const albums = pgTable('albums', {
  id: text('id')
    .primaryKey()
    .references(() => vfsRegistry.id, { onDelete: 'cascade' }),
  encryptedName: text('encrypted_name'),
  encryptedDescription: text('encrypted_description'),
  coverPhotoId: text('cover_photo_id').references(() => vfsRegistry.id, {
    onDelete: 'set null'
  }),
  albumType: text('album_type', {
    enum: ['photoroll', 'custom']
  })
    .notNull()
    .default('custom')
});

/**
 * Contact groups - extends registry for contactGroup-type items.
 * Stores encrypted contact group metadata.
 */
export const contactGroups = pgTable('contact_groups', {
  id: text('id')
    .primaryKey()
    .references(() => vfsRegistry.id, { onDelete: 'cascade' }),
  encryptedName: text('encrypted_name'),
  color: text('color'),
  icon: text('icon')
});

/**
 * Email folders - extends registry for emailFolder-type items.
 * Stores email folder metadata including sync state for IMAP.
 */
export const emailFolders = pgTable('email_folders', {
  id: text('id')
    .primaryKey()
    .references(() => vfsRegistry.id, { onDelete: 'cascade' }),
  encryptedName: text('encrypted_name'),
  folderType: text('folder_type', {
    enum: ['inbox', 'sent', 'drafts', 'trash', 'spam', 'custom']
  }),
  unreadCount: integer('unread_count').notNull().default(0),
  syncUidValidity: integer('sync_uid_validity'),
  syncLastUid: integer('sync_last_uid')
});

/**
 * Tags - extends registry for tag-type items.
 * Stores tag metadata for cross-cutting organization.
 */
export const tags = pgTable(
  'tags',
  {
    id: text('id')
      .primaryKey()
      .references(() => vfsRegistry.id, { onDelete: 'cascade' }),
    encryptedName: text('encrypted_name'),
    color: text('color'),
    icon: text('icon'),
    deleted: boolean('deleted').notNull().default(false)
  },
  (table) => [index('tags_deleted_idx').on(table.deleted)]
);

/**
 * Wallet items - extends registry for walletItem-type entries.
 * Stores structured identity and payment card metadata with soft-delete support.
 */
export const walletItems = pgTable(
  'wallet_items',
  {
    id: text('id')
      .primaryKey()
      .references(() => vfsRegistry.id, { onDelete: 'cascade' }),
    itemType: text('item_type', {
      enum: [
        'passport',
        'driverLicense',
        'birthCertificate',
        'creditCard',
        'debitCard',
        'identityCard',
        'insuranceCard',
        'other'
      ]
    }).notNull(),
    displayName: text('display_name').notNull(),
    issuingAuthority: text('issuing_authority'),
    countryCode: text('country_code'),
    documentNumberLast4: text('document_number_last4'),
    issuedOn: timestamp('issued_on', { withTimezone: true }),
    expiresOn: timestamp('expires_on', { withTimezone: true }),
    notes: text('notes'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    deleted: boolean('deleted').notNull().default(false)
  },
  (table) => [
    index('wallet_items_type_idx').on(table.itemType),
    index('wallet_items_expires_idx').on(table.expiresOn),
    index('wallet_items_deleted_idx').on(table.deleted),
    index('wallet_items_updated_idx').on(table.updatedAt)
  ]
);

/**
 * Wallet item media links front/back card images to files.
 */
export const walletItemMedia = pgTable(
  'wallet_item_media',
  {
    id: text('id').primaryKey(),
    walletItemId: text('wallet_item_id')
      .notNull()
      .references(() => walletItems.id, { onDelete: 'cascade' }),
    fileId: text('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    side: text('side', {
      enum: ['front', 'back']
    }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull()
  },
  (table) => [
    index('wallet_item_media_item_idx').on(table.walletItemId),
    index('wallet_item_media_file_idx').on(table.fileId),
    uniqueIndex('wallet_item_media_item_side_idx').on(
      table.walletItemId,
      table.side
    )
  ]
);

/**
 * Emails - extends registry for email-type items.
 * Stores encrypted email metadata.
 */
export const emails = pgTable(
  'emails',
  {
    id: text('id')
      .primaryKey()
      .references(() => vfsRegistry.id, { onDelete: 'cascade' }),
    encryptedSubject: text('encrypted_subject'),
    encryptedFrom: text('encrypted_from'),
    encryptedTo: jsonb('encrypted_to'),
    encryptedCc: jsonb('encrypted_cc'),
    encryptedBodyPath: text('encrypted_body_path'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
    isRead: boolean('is_read').notNull().default(false),
    isStarred: boolean('is_starred').notNull().default(false)
  },
  (table) => [index('emails_received_at_idx').on(table.receivedAt)]
);

/**
 * Composed emails - extends registry for draft and sent email items.
 * Stores encrypted composed email content for drafts and sent messages.
 */
export const composedEmails = pgTable(
  'composed_emails',
  {
    id: text('id')
      .primaryKey()
      .references(() => vfsRegistry.id, { onDelete: 'cascade' }),
    encryptedTo: jsonb('encrypted_to'),
    encryptedCc: jsonb('encrypted_cc'),
    encryptedBcc: jsonb('encrypted_bcc'),
    encryptedSubject: text('encrypted_subject'),
    encryptedBody: text('encrypted_body'),
    status: text('status', {
      enum: ['draft', 'sending', 'sent', 'failed']
    })
      .notNull()
      .default('draft'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull()
  },
  (table) => [
    index('composed_emails_status_idx').on(table.status),
    index('composed_emails_updated_idx').on(table.updatedAt)
  ]
);

/**
 * Email attachments - file references for composed emails.
 * Links attachments to composed emails with metadata.
 */
export const emailAttachments = pgTable(
  'email_attachments',
  {
    id: text('id').primaryKey(),
    composedEmailId: text('composed_email_id')
      .notNull()
      .references(() => composedEmails.id, { onDelete: 'cascade' }),
    encryptedFileName: text('encrypted_file_name').notNull(),
    mimeType: text('mime_type').notNull(),
    size: integer('size').notNull(),
    encryptedStoragePath: text('encrypted_storage_path').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull()
  },
  (table) => [index('email_attachments_email_idx').on(table.composedEmailId)]
);

/**
 * VFS shares - sharing items with users, groups, and organizations.
 * Supports permission levels and optional expiration dates.
 */
export const vfsShares = pgTable(
  'vfs_shares',
  {
    id: text('id').primaryKey(),
    itemId: text('item_id')
      .notNull()
      .references(() => vfsRegistry.id, { onDelete: 'cascade' }),
    shareType: text('share_type', {
      enum: ['user', 'group', 'organization']
    }).notNull(),
    targetId: text('target_id').notNull(),
    permissionLevel: text('permission_level', {
      enum: ['view', 'edit', 'download']
    }).notNull(),
    wrappedSessionKey: text('wrapped_session_key'),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true })
  },
  (table) => [
    index('vfs_shares_item_idx').on(table.itemId),
    index('vfs_shares_target_idx').on(table.targetId),
    uniqueIndex('vfs_shares_item_target_type_idx').on(
      table.itemId,
      table.targetId,
      table.shareType
    ),
    index('vfs_shares_expires_idx').on(table.expiresAt)
  ]
);

/**
 * Organization shares - sharing items between organizations.
 * Enables org-to-org sharing with permission levels and expiration.
 */
export const orgShares = pgTable(
  'org_shares',
  {
    id: text('id').primaryKey(),
    sourceOrgId: text('source_org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    targetOrgId: text('target_org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    itemId: text('item_id')
      .notNull()
      .references(() => vfsRegistry.id, { onDelete: 'cascade' }),
    permissionLevel: text('permission_level', {
      enum: ['view', 'edit', 'download']
    }).notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true })
  },
  (table) => [
    index('org_shares_item_idx').on(table.itemId),
    index('org_shares_source_idx').on(table.sourceOrgId),
    index('org_shares_target_idx').on(table.targetOrgId),
    uniqueIndex('org_shares_unique_idx').on(
      table.sourceOrgId,
      table.targetOrgId,
      table.itemId
    )
  ]
);

/**
 * VFS access - direct access grants for sharing items with users.
 * Stores wrapped keys encrypted with user's public key.
 */
export const vfsAccess = pgTable(
  'vfs_access',
  {
    itemId: text('item_id')
      .notNull()
      .references(() => vfsRegistry.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    wrappedSessionKey: text('wrapped_session_key').notNull(),
    wrappedHierarchicalKey: text('wrapped_hierarchical_key'),
    permissionLevel: text('permission_level', {
      enum: ['read', 'write', 'admin']
    }).notNull(),
    grantedBy: text('granted_by').references(() => users.id, {
      onDelete: 'restrict'
    }),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true })
  },
  (table) => [
    primaryKey({ columns: [table.itemId, table.userId] }),
    index('vfs_access_user_idx').on(table.userId),
    index('vfs_access_item_idx').on(table.itemId)
  ]
);

/**
 * Flattened ACL entries for VFS items.
 * Unifies user/group/organization grants into a single principal model.
 */
export const vfsAclEntries = pgTable(
  'vfs_acl_entries',
  {
    id: text('id').primaryKey(),
    itemId: text('item_id')
      .notNull()
      .references(() => vfsRegistry.id, { onDelete: 'cascade' }),
    principalType: text('principal_type', {
      enum: ['user', 'group', 'organization']
    }).notNull(),
    principalId: text('principal_id').notNull(),
    accessLevel: text('access_level', {
      enum: ['read', 'write', 'admin']
    }).notNull(),
    wrappedSessionKey: text('wrapped_session_key'),
    wrappedHierarchicalKey: text('wrapped_hierarchical_key'),
    grantedBy: text('granted_by').references(() => users.id, {
      onDelete: 'restrict'
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true })
  },
  (table) => [
    index('vfs_acl_entries_item_idx').on(table.itemId),
    index('vfs_acl_entries_principal_idx').on(
      table.principalType,
      table.principalId
    ),
    index('vfs_acl_entries_active_idx').on(
      table.principalType,
      table.principalId,
      table.revokedAt,
      table.expiresAt
    ),
    uniqueIndex('vfs_acl_entries_item_principal_idx').on(
      table.itemId,
      table.principalType,
      table.principalId
    )
  ]
);

/**
 * Append-only VFS change feed for cursor-based differential synchronization.
 * Records all item and ACL mutations in a stable time-ordered stream.
 */
export const vfsSyncChanges = pgTable(
  'vfs_sync_changes',
  {
    id: text('id').primaryKey(),
    itemId: text('item_id')
      .notNull()
      .references(() => vfsRegistry.id, { onDelete: 'cascade' }),
    changeType: text('change_type', {
      enum: ['upsert', 'delete', 'acl']
    }).notNull(),
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull(),
    changedBy: text('changed_by').references(() => users.id, {
      onDelete: 'set null'
    }),
    rootId: text('root_id').references(() => vfsRegistry.id, {
      onDelete: 'set null'
    })
  },
  (table) => [
    index('vfs_sync_changes_item_idx').on(table.itemId),
    index('vfs_sync_changes_changed_at_idx').on(table.changedAt),
    index('vfs_sync_changes_root_idx').on(table.rootId),
    index('vfs_sync_changes_item_changed_idx').on(table.itemId, table.changedAt)
  ]
);

/**
 * Per-user/per-client sync cursor reconciliation state.
 * Tracks the latest cursor each client has fully applied.
 */
export const vfsSyncClientState = pgTable(
  'vfs_sync_client_state',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    clientId: text('client_id').notNull(),
    lastReconciledAt: timestamp('last_reconciled_at', {
      withTimezone: true
    }).notNull(),
    lastReconciledChangeId: text('last_reconciled_change_id').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull()
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.clientId] }),
    index('vfs_sync_client_state_user_idx').on(table.userId)
  ]
);

/**
 * Blob object registry for VFS-backed binary payloads.
 * Tracks immutable blob metadata independent of attachment lifecycle.
 */
export const vfsBlobObjects = pgTable(
  'vfs_blob_objects',
  {
    id: text('id').primaryKey(),
    sha256: text('sha256').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    storageKey: text('storage_key').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull()
  },
  (table) => [
    uniqueIndex('vfs_blob_objects_storage_key_idx').on(table.storageKey),
    index('vfs_blob_objects_sha_idx').on(table.sha256)
  ]
);

/**
 * CRDT-style operation log for ACL and link mutations.
 * Ensures deterministic convergence for concurrent multi-client updates.
 */
export const vfsCrdtOps = pgTable(
  'vfs_crdt_ops',
  {
    id: text('id').primaryKey(),
    itemId: text('item_id')
      .notNull()
      .references(() => vfsRegistry.id, { onDelete: 'cascade' }),
    opType: text('op_type', {
      enum: ['acl_add', 'acl_remove', 'link_add', 'link_remove']
    }).notNull(),
    principalType: text('principal_type', {
      enum: ['user', 'group', 'organization']
    }),
    principalId: text('principal_id'),
    accessLevel: text('access_level', {
      enum: ['read', 'write', 'admin']
    }),
    parentId: text('parent_id'),
    childId: text('child_id'),
    actorId: text('actor_id').references(() => users.id, {
      onDelete: 'set null'
    }),
    sourceTable: text('source_table').notNull(),
    sourceId: text('source_id').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull()
  },
  (table) => [
    index('vfs_crdt_ops_item_idx').on(table.itemId),
    index('vfs_crdt_ops_occurred_idx').on(table.occurredAt),
    index('vfs_crdt_ops_source_idx').on(table.sourceTable, table.sourceId)
  ]
);

/**
 * MLS key packages for user identity.
 * Each package is consumed once when used to add user to a group.
 */
export const mlsKeyPackages = pgTable(
  'mls_key_packages',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    keyPackageData: text('key_package_data').notNull(),
    keyPackageRef: text('key_package_ref').notNull(),
    cipherSuite: integer('cipher_suite').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    consumedByGroupId: text('consumed_by_group_id').references(
      () => mlsGroups.id,
      { onDelete: 'set null' }
    )
  },
  (table) => [
    index('mls_key_packages_user_idx').on(table.userId),
    uniqueIndex('mls_key_packages_ref_idx').on(table.keyPackageRef)
  ]
);

/**
 * MLS chat groups with epoch tracking for forward secrecy.
 * Groups manage cryptographic state and membership through MLS protocol.
 */
export const mlsGroups = pgTable(
  'mls_groups',
  {
    id: text('id').primaryKey(),
    groupIdMls: text('group_id_mls').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    creatorUserId: text('creator_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    currentEpoch: integer('current_epoch').notNull().default(0),
    cipherSuite: integer('cipher_suite').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull()
  },
  (table) => [
    uniqueIndex('mls_groups_group_id_mls_idx').on(table.groupIdMls),
    index('mls_groups_org_idx').on(table.organizationId),
    index('mls_groups_creator_idx').on(table.creatorUserId)
  ]
);

/**
 * MLS group membership tracking.
 * Tracks which users are members of which groups with their MLS leaf index.
 */
export const mlsGroupMembers = pgTable(
  'mls_group_members',
  {
    groupId: text('group_id')
      .notNull()
      .references(() => mlsGroups.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    leafIndex: integer('leaf_index'),
    role: text('role', {
      enum: ['admin', 'member']
    })
      .notNull()
      .default('member'),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull(),
    joinedAtEpoch: integer('joined_at_epoch').notNull(),
    removedAt: timestamp('removed_at', { withTimezone: true })
  },
  (table) => [
    primaryKey({ columns: [table.groupId, table.userId] }),
    index('mls_group_members_user_idx').on(table.userId),
    index('mls_group_members_active_idx').on(table.groupId, table.removedAt)
  ]
);

/**
 * MLS encrypted messages.
 * Server stores ciphertext only - decryption happens client-side.
 */
export const mlsMessages = pgTable(
  'mls_messages',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id')
      .notNull()
      .references(() => mlsGroups.id, { onDelete: 'cascade' }),
    senderUserId: text('sender_user_id').references(() => users.id, {
      onDelete: 'set null'
    }),
    epoch: integer('epoch').notNull(),
    ciphertext: text('ciphertext').notNull(),
    messageType: text('message_type', {
      enum: ['application', 'commit', 'proposal']
    }).notNull(),
    contentType: text('content_type').default('text/plain'),
    sequenceNumber: integer('sequence_number').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull()
  },
  (table) => [
    uniqueIndex('mls_messages_group_seq_unique').on(
      table.groupId,
      table.sequenceNumber
    ),
    index('mls_messages_group_epoch_idx').on(table.groupId, table.epoch),
    index('mls_messages_created_idx').on(table.createdAt)
  ]
);

/**
 * MLS welcome messages for new group members.
 * Contains encrypted group state needed to join.
 */
export const mlsWelcomeMessages = pgTable(
  'mls_welcome_messages',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id')
      .notNull()
      .references(() => mlsGroups.id, { onDelete: 'cascade' }),
    recipientUserId: text('recipient_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    keyPackageRef: text('key_package_ref').notNull(),
    welcomeData: text('welcome_data').notNull(),
    epoch: integer('epoch').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true })
  },
  (table) => [
    index('mls_welcome_recipient_idx').on(
      table.recipientUserId,
      table.consumedAt
    ),
    index('mls_welcome_group_idx').on(table.groupId)
  ]
);

/**
 * MLS group state snapshots for recovery and multi-device sync.
 * Stores encrypted serialized MLS state at specific epochs.
 */
export const mlsGroupState = pgTable(
  'mls_group_state',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id')
      .notNull()
      .references(() => mlsGroups.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    epoch: integer('epoch').notNull(),
    encryptedState: text('encrypted_state').notNull(),
    stateHash: text('state_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull()
  },
  (table) => [
    uniqueIndex('mls_group_state_user_group_unique').on(
      table.groupId,
      table.userId
    ),
    index('mls_group_state_epoch_idx').on(table.groupId, table.epoch)
  ]
);

/**
 * AI conversations - stores encrypted conversation metadata.
 * Each conversation belongs to a user and optionally an organization.
 */
export const aiConversations = pgTable(
  'ai_conversations',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id').references(() => organizations.id, {
      onDelete: 'set null'
    }),
    encryptedTitle: text('encrypted_title').notNull(),
    encryptedSessionKey: text('encrypted_session_key').notNull(),
    modelId: text('model_id'),
    messageCount: integer('message_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    deleted: boolean('deleted').notNull().default(false)
  },
  (table) => [
    index('ai_conversations_user_idx').on(
      table.userId,
      table.deleted,
      table.updatedAt
    ),
    index('ai_conversations_org_idx').on(table.organizationId)
  ]
);

/**
 * AI messages - stores encrypted message content.
 * Messages are encrypted client-side before storage.
 */
export const aiMessages = pgTable(
  'ai_messages',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => aiConversations.id, { onDelete: 'cascade' }),
    role: text('role', {
      enum: ['system', 'user', 'assistant']
    }).notNull(),
    encryptedContent: text('encrypted_content').notNull(),
    modelId: text('model_id'),
    sequenceNumber: integer('sequence_number').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull()
  },
  (table) => [
    index('ai_messages_conversation_idx').on(
      table.conversationId,
      table.sequenceNumber
    )
  ]
);

/**
 * AI usage - tracks token usage per request for billing/analytics.
 * Usage data is stored in plaintext (not encrypted) for aggregation.
 */
export const aiUsage = pgTable(
  'ai_usage',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id').references(
      () => aiConversations.id,
      { onDelete: 'set null' }
    ),
    messageId: text('message_id').references(() => aiMessages.id, {
      onDelete: 'set null'
    }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id').references(() => organizations.id, {
      onDelete: 'set null'
    }),
    modelId: text('model_id').notNull(),
    promptTokens: integer('prompt_tokens').notNull(),
    completionTokens: integer('completion_tokens').notNull(),
    totalTokens: integer('total_tokens').notNull(),
    openrouterRequestId: text('openrouter_request_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull()
  },
  (table) => [
    index('ai_usage_user_idx').on(table.userId, table.createdAt),
    index('ai_usage_org_idx').on(table.organizationId, table.createdAt),
    index('ai_usage_conversation_idx').on(table.conversationId)
  ]
);

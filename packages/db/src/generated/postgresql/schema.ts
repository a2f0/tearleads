import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
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
    createdAt: timestamp('created_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
    lastActiveAt: timestamp('last_active_at', { withTimezone: true })
  },
  (table) => [index('users_email_idx').on(table.email)]
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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull()
  },
  (table) => [uniqueIndex('organizations_name_idx').on(table.name)]
);

/**
 * Junction table for many-to-many relationship between users and organizations.
 */
export const userOrganizations = pgTable(
  'user_organizations',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id')
      .primaryKey()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull()
  },
  (table) => [index('user_organizations_org_idx').on(table.organizationId)]
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
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    groupId: text('group_id')
      .primaryKey()
      .references(() => groups.id, { onDelete: 'cascade' }),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull()
  },
  (table) => [index('user_groups_group_idx').on(table.groupId)]
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
 */
export const vfsRegistry = pgTable(
  'vfs_registry',
  {
    id: text('id').primaryKey(),
    objectType: text('object_type').notNull(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
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
  encryptedName: text('encrypted_name')
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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull()
  },
  (table) => [
    index('vfs_links_parent_idx').on(table.parentId),
    index('vfs_links_child_idx').on(table.childId),
    uniqueIndex('vfs_links_parent_child_idx').on(table.parentId, table.childId)
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
      .primaryKey()
      .references(() => vfsRegistry.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .primaryKey()
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
    index('vfs_access_user_idx').on(table.userId),
    index('vfs_access_item_idx').on(table.itemId)
  ]
);

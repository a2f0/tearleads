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
  })
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
export const tags = pgTable('tags', {
  id: text('id')
    .primaryKey()
    .references(() => vfsRegistry.id, { onDelete: 'cascade' }),
  encryptedName: text('encrypted_name'),
  color: text('color'),
  icon: text('icon')
});

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
    consumedByGroupId: text('consumed_by_group_id')
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
      .primaryKey()
      .references(() => mlsGroups.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .primaryKey()
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

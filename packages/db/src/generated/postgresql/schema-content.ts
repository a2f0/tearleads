import {
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

import { files, users } from './schema-foundation.js';

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
    encryptedName: text('encrypted_name'),
    icon: text('icon'),
    viewMode: text('view_mode'),
    defaultSort: text('default_sort'),
    sortDirection: text('sort_direction'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull()
  },
  (table) => [
    index('vfs_registry_owner_idx').on(table.ownerId),
    index('vfs_registry_type_idx').on(table.objectType)
  ]
);

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
 * CRDT-style operation log for ACL and link mutations.
 * Ensures deterministic convergence for concurrent multi-client updates.
 */

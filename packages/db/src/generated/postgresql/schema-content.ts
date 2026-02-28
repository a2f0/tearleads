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
    organizationId: text('organization_id'),
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
    index('vfs_registry_type_idx').on(table.objectType),
    index('vfs_registry_org_idx').on(table.organizationId)
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
 * AI conversations - extends vfs_registry for conversation-type items.
 * Stores encrypted conversation metadata as a VFS object.
 */
export const aiConversations = pgTable(
  'ai_conversations',
  {
    id: text('id')
      .primaryKey()
      .references(() => vfsRegistry.id, { onDelete: 'cascade' }),
    encryptedTitle: text('encrypted_title').notNull(),
    modelId: text('model_id'),
    messageCount: integer('message_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull()
  },
  (table) => [index('ai_conversations_updated_idx').on(table.updatedAt)]
);

/**
 * AI messages - stores encrypted message content.
 * Child table of ai_conversations, materialized from CRDT payload.
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
    ciphertextSize: integer('ciphertext_size').notNull().default(0),
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
 * Policy headers for container-scoped sharing rules.
 * Defines root scope and lifecycle metadata for share-policy compilation.
 */

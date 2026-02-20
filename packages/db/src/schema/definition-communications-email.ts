import type { TableDefinition } from './types.js';

/**
 * Email folders - extends registry for emailFolder-type items.
 * Stores email folder metadata including sync state for IMAP.
 */
export const emailFoldersTable: TableDefinition = {
  name: 'email_folders',
  propertyName: 'emailFolders',
  comment:
    'Email folders - extends registry for emailFolder-type items.\nStores email folder metadata including sync state for IMAP.',
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
    },
    folderType: {
      type: 'text',
      sqlName: 'folder_type',
      enumValues: [
        'inbox',
        'sent',
        'drafts',
        'trash',
        'spam',
        'custom'
      ] as const
    },
    unreadCount: {
      type: 'integer',
      sqlName: 'unread_count',
      notNull: true,
      defaultValue: 0
    },
    syncUidValidity: {
      type: 'integer',
      sqlName: 'sync_uid_validity'
    },
    syncLastUid: {
      type: 'integer',
      sqlName: 'sync_last_uid'
    }
  }
};

/**
 * Emails - extends registry for email-type items.
 * Stores encrypted email metadata.
 */
export const emailsTable: TableDefinition = {
  name: 'emails',
  propertyName: 'emails',
  comment:
    'Emails - extends registry for email-type items.\nStores encrypted email metadata.',
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
    encryptedSubject: {
      type: 'text',
      sqlName: 'encrypted_subject'
    },
    encryptedFrom: {
      type: 'text',
      sqlName: 'encrypted_from'
    },
    encryptedTo: {
      type: 'json',
      sqlName: 'encrypted_to'
    },
    encryptedCc: {
      type: 'json',
      sqlName: 'encrypted_cc'
    },
    encryptedBodyPath: {
      type: 'text',
      sqlName: 'encrypted_body_path'
    },
    receivedAt: {
      type: 'timestamp',
      sqlName: 'received_at',
      notNull: true
    },
    isRead: {
      type: 'boolean',
      sqlName: 'is_read',
      notNull: true,
      defaultValue: false
    },
    isStarred: {
      type: 'boolean',
      sqlName: 'is_starred',
      notNull: true,
      defaultValue: false
    }
  },
  indexes: [{ name: 'emails_received_at_idx', columns: ['receivedAt'] }]
};

/**
 * Composed emails - extends registry for draft and sent email items.
 * Stores encrypted composed email content for drafts and sent messages.
 */
export const composedEmailsTable: TableDefinition = {
  name: 'composed_emails',
  propertyName: 'composedEmails',
  comment:
    'Composed emails - extends registry for draft and sent email items.\nStores encrypted composed email content for drafts and sent messages.',
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
    encryptedTo: {
      type: 'json',
      sqlName: 'encrypted_to'
    },
    encryptedCc: {
      type: 'json',
      sqlName: 'encrypted_cc'
    },
    encryptedBcc: {
      type: 'json',
      sqlName: 'encrypted_bcc'
    },
    encryptedSubject: {
      type: 'text',
      sqlName: 'encrypted_subject'
    },
    encryptedBody: {
      type: 'text',
      sqlName: 'encrypted_body'
    },
    status: {
      type: 'text',
      sqlName: 'status',
      notNull: true,
      defaultValue: 'draft',
      enumValues: ['draft', 'sending', 'sent', 'failed'] as const
    },
    sentAt: {
      type: 'timestamp',
      sqlName: 'sent_at'
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
    { name: 'composed_emails_status_idx', columns: ['status'] },
    { name: 'composed_emails_updated_idx', columns: ['updatedAt'] }
  ]
};

/**
 * Email attachments - file references for composed emails.
 * Links attachments to composed emails with metadata.
 */
export const emailAttachmentsTable: TableDefinition = {
  name: 'email_attachments',
  propertyName: 'emailAttachments',
  comment:
    'Email attachments - file references for composed emails.\nLinks attachments to composed emails with metadata.',
  columns: {
    id: {
      type: 'text',
      sqlName: 'id',
      primaryKey: true
    },
    composedEmailId: {
      type: 'text',
      sqlName: 'composed_email_id',
      notNull: true,
      references: {
        table: 'composed_emails',
        column: 'id',
        onDelete: 'cascade'
      }
    },
    encryptedFileName: {
      type: 'text',
      sqlName: 'encrypted_file_name',
      notNull: true
    },
    mimeType: {
      type: 'text',
      sqlName: 'mime_type',
      notNull: true
    },
    size: {
      type: 'integer',
      sqlName: 'size',
      notNull: true
    },
    encryptedStoragePath: {
      type: 'text',
      sqlName: 'encrypted_storage_path',
      notNull: true
    },
    createdAt: {
      type: 'timestamp',
      sqlName: 'created_at',
      notNull: true
    }
  },
  indexes: [
    { name: 'email_attachments_email_idx', columns: ['composedEmailId'] }
  ]
};

export const communicationsEmailTables: TableDefinition[] = [
  emailFoldersTable,
  emailsTable,
  composedEmailsTable,
  emailAttachmentsTable
];

import type { TableDefinition } from './types.js';

export { emailsTable } from './definition-communications-email.js';
export {
  vfsAclEntriesTable,
  vfsBlobObjectsTable,
  vfsBlobRefsTable,
  vfsBlobStagingTable,
  vfsSyncChangesTable,
  vfsSyncClientStateTable
} from './definition-communications-vfs.js';
export {
  communicationsVfsPolicyTables,
  vfsAclEntryProvenanceTable,
  vfsSharePoliciesTable,
  vfsSharePolicyPrincipalsTable,
  vfsSharePolicySelectorsTable
} from './definitionCommunicationsVfsPolicy.js';

import { communicationsEmailTables } from './definition-communications-email.js';
import { communicationsVfsTables } from './definition-communications-vfs.js';
// Import for combining into communicationsTables
import { communicationsAiTables } from './definitionCommunicationsAi.js';
import { communicationsVfsPolicyTables } from './definitionCommunicationsVfsPolicy.js';

export const contactGroupsTable: TableDefinition = {
  name: 'contact_groups',
  propertyName: 'contactGroups',
  comment:
    'Contact groups - extends registry for contactGroup-type items.\nStores encrypted contact group metadata.',
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
    color: {
      type: 'text',
      sqlName: 'color'
    },
    icon: {
      type: 'text',
      sqlName: 'icon'
    }
  }
};

/**
 * Tags - extends registry for tag-type items.
 * Stores tag metadata for cross-cutting organization.
 */
export const tagsTable: TableDefinition = {
  name: 'tags',
  propertyName: 'tags',
  comment:
    'Tags - extends registry for tag-type items.\nStores tag metadata for cross-cutting organization.',
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
    color: {
      type: 'text',
      sqlName: 'color'
    },
    icon: {
      type: 'text',
      sqlName: 'icon'
    },
    deleted: {
      type: 'boolean',
      sqlName: 'deleted',
      notNull: true,
      defaultValue: false
    }
  },
  indexes: [{ name: 'tags_deleted_idx', columns: ['deleted'] }]
};

/**
 * Wallet items - extends registry for walletItem-type entries.
 * Stores structured identity and payment card metadata with soft-delete support.
 */
export const walletItemsTable: TableDefinition = {
  name: 'wallet_items',
  propertyName: 'walletItems',
  comment:
    'Wallet items - extends registry for walletItem-type entries.\nStores structured identity and payment card metadata with soft-delete support.',
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
    itemType: {
      type: 'text',
      sqlName: 'item_type',
      notNull: true,
      enumValues: [
        'passport',
        'driverLicense',
        'birthCertificate',
        'creditCard',
        'debitCard',
        'identityCard',
        'insuranceCard',
        'other'
      ] as const
    },
    displayName: {
      type: 'text',
      sqlName: 'display_name',
      notNull: true
    },
    issuingAuthority: {
      type: 'text',
      sqlName: 'issuing_authority'
    },
    countryCode: {
      type: 'text',
      sqlName: 'country_code'
    },
    documentNumberLast4: {
      type: 'text',
      sqlName: 'document_number_last4'
    },
    issuedOn: {
      type: 'timestamp',
      sqlName: 'issued_on'
    },
    expiresOn: {
      type: 'timestamp',
      sqlName: 'expires_on'
    },
    notes: {
      type: 'text',
      sqlName: 'notes'
    },
    metadata: {
      type: 'json',
      sqlName: 'metadata'
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
    { name: 'wallet_items_type_idx', columns: ['itemType'] },
    { name: 'wallet_items_expires_idx', columns: ['expiresOn'] },
    { name: 'wallet_items_deleted_idx', columns: ['deleted'] },
    { name: 'wallet_items_updated_idx', columns: ['updatedAt'] }
  ]
};

/**
 * Wallet item media links front/back card images to files.
 */
export const walletItemMediaTable: TableDefinition = {
  name: 'wallet_item_media',
  propertyName: 'walletItemMedia',
  comment: 'Wallet item media links front/back card images to files.',
  columns: {
    id: {
      type: 'text',
      sqlName: 'id',
      primaryKey: true
    },
    walletItemId: {
      type: 'text',
      sqlName: 'wallet_item_id',
      notNull: true,
      references: {
        table: 'wallet_items',
        column: 'id',
        onDelete: 'cascade'
      }
    },
    fileId: {
      type: 'text',
      sqlName: 'file_id',
      notNull: true,
      references: {
        table: 'files',
        column: 'id',
        onDelete: 'cascade'
      }
    },
    side: {
      type: 'text',
      sqlName: 'side',
      notNull: true,
      enumValues: ['front', 'back'] as const
    },
    createdAt: {
      type: 'timestamp',
      sqlName: 'created_at',
      notNull: true
    }
  },
  indexes: [
    { name: 'wallet_item_media_item_idx', columns: ['walletItemId'] },
    { name: 'wallet_item_media_file_idx', columns: ['fileId'] },
    {
      name: 'wallet_item_media_item_side_idx',
      columns: ['walletItemId', 'side'],
      unique: true
    }
  ]
};

export const communicationsTables: TableDefinition[] = [
  contactGroupsTable,
  ...communicationsAiTables,
  ...communicationsEmailTables,
  tagsTable,
  walletItemsTable,
  walletItemMediaTable,
  ...communicationsVfsPolicyTables,
  ...communicationsVfsTables
];

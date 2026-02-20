import type { TableDefinition } from './types.js';

// =============================================================================
// MLS (RFC 9420) Encrypted Chat Tables
// =============================================================================
// Design Note: MLS implements end-to-end encryption where the server only stores
// ciphertext. All binary data (key packages, ciphertext, state) is base64-encoded.
// The X-Wing hybrid ciphersuite (ML-KEM + X25519) is used for post-quantum security.

/**
 * MLS key packages for user identity.
 * Users upload key packages that other users consume when adding them to groups.
 * Each key package can only be used once (consumed on group add).
 */
export const mlsKeyPackagesTable: TableDefinition = {
  name: 'mls_key_packages',
  propertyName: 'mlsKeyPackages',
  comment:
    'MLS key packages for user identity.\nEach package is consumed once when used to add user to a group.',
  columns: {
    id: {
      type: 'text',
      sqlName: 'id',
      primaryKey: true
    },
    userId: {
      type: 'text',
      sqlName: 'user_id',
      notNull: true,
      references: {
        table: 'users',
        column: 'id',
        onDelete: 'cascade'
      }
    },
    keyPackageData: {
      type: 'text',
      sqlName: 'key_package_data',
      notNull: true
    },
    keyPackageRef: {
      type: 'text',
      sqlName: 'key_package_ref',
      notNull: true
    },
    cipherSuite: {
      type: 'integer',
      sqlName: 'cipher_suite',
      notNull: true
    },
    createdAt: {
      type: 'timestamp',
      sqlName: 'created_at',
      notNull: true
    },
    consumedAt: {
      type: 'timestamp',
      sqlName: 'consumed_at'
    },
    consumedByGroupId: {
      type: 'text',
      sqlName: 'consumed_by_group_id',
      references: {
        table: 'mls_groups',
        column: 'id',
        onDelete: 'set null'
      }
    }
  },
  indexes: [
    { name: 'mls_key_packages_user_idx', columns: ['userId'] },
    {
      name: 'mls_key_packages_ref_idx',
      columns: ['keyPackageRef'],
      unique: true
    }
  ]
};

/**
 * MLS chat groups with epoch tracking for forward secrecy.
 * Groups manage cryptographic state and membership through MLS protocol.
 */
export const mlsGroupsTable: TableDefinition = {
  name: 'mls_groups',
  propertyName: 'mlsGroups',
  comment:
    'MLS chat groups with epoch tracking for forward secrecy.\nGroups manage cryptographic state and membership through MLS protocol.',
  columns: {
    id: {
      type: 'text',
      sqlName: 'id',
      primaryKey: true
    },
    groupIdMls: {
      type: 'text',
      sqlName: 'group_id_mls',
      notNull: true
    },
    name: {
      type: 'text',
      sqlName: 'name',
      notNull: true
    },
    description: {
      type: 'text',
      sqlName: 'description'
    },
    organizationId: {
      type: 'text',
      sqlName: 'organization_id',
      notNull: true,
      references: {
        table: 'organizations',
        column: 'id',
        onDelete: 'cascade'
      }
    },
    creatorUserId: {
      type: 'text',
      sqlName: 'creator_user_id',
      notNull: true,
      references: {
        table: 'users',
        column: 'id',
        onDelete: 'restrict'
      }
    },
    currentEpoch: {
      type: 'integer',
      sqlName: 'current_epoch',
      notNull: true,
      defaultValue: 0
    },
    cipherSuite: {
      type: 'integer',
      sqlName: 'cipher_suite',
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
  },
  indexes: [
    {
      name: 'mls_groups_group_id_mls_idx',
      columns: ['groupIdMls'],
      unique: true
    },
    { name: 'mls_groups_org_idx', columns: ['organizationId'] },
    { name: 'mls_groups_creator_idx', columns: ['creatorUserId'] }
  ]
};

/**
 * MLS group membership tracking.
 * Tracks which users are members of which groups with their MLS leaf index.
 */
export const mlsGroupMembersTable: TableDefinition = {
  name: 'mls_group_members',
  propertyName: 'mlsGroupMembers',
  comment:
    'MLS group membership tracking.\nTracks which users are members of which groups with their MLS leaf index.',
  columns: {
    groupId: {
      type: 'text',
      sqlName: 'group_id',
      primaryKey: true,
      references: {
        table: 'mls_groups',
        column: 'id',
        onDelete: 'cascade'
      }
    },
    userId: {
      type: 'text',
      sqlName: 'user_id',
      primaryKey: true,
      references: {
        table: 'users',
        column: 'id',
        onDelete: 'cascade'
      }
    },
    leafIndex: {
      type: 'integer',
      sqlName: 'leaf_index'
    },
    role: {
      type: 'text',
      sqlName: 'role',
      notNull: true,
      defaultValue: 'member',
      enumValues: ['admin', 'member'] as const
    },
    joinedAt: {
      type: 'timestamp',
      sqlName: 'joined_at',
      notNull: true
    },
    joinedAtEpoch: {
      type: 'integer',
      sqlName: 'joined_at_epoch',
      notNull: true
    },
    removedAt: {
      type: 'timestamp',
      sqlName: 'removed_at'
    }
  },
  indexes: [
    { name: 'mls_group_members_user_idx', columns: ['userId'] },
    { name: 'mls_group_members_active_idx', columns: ['groupId', 'removedAt'] }
  ]
};

/**
 * MLS encrypted messages.
 * Server stores ciphertext only - decryption happens client-side.
 */
export const mlsMessagesTable: TableDefinition = {
  name: 'mls_messages',
  propertyName: 'mlsMessages',
  comment:
    'MLS encrypted messages.\nServer stores ciphertext only - decryption happens client-side.',
  columns: {
    id: {
      type: 'text',
      sqlName: 'id',
      primaryKey: true
    },
    groupId: {
      type: 'text',
      sqlName: 'group_id',
      notNull: true,
      references: {
        table: 'mls_groups',
        column: 'id',
        onDelete: 'cascade'
      }
    },
    senderUserId: {
      type: 'text',
      sqlName: 'sender_user_id',
      references: {
        table: 'users',
        column: 'id',
        onDelete: 'set null'
      }
    },
    epoch: {
      type: 'integer',
      sqlName: 'epoch',
      notNull: true
    },
    ciphertext: {
      type: 'text',
      sqlName: 'ciphertext',
      notNull: true
    },
    messageType: {
      type: 'text',
      sqlName: 'message_type',
      notNull: true,
      enumValues: ['application', 'commit', 'proposal'] as const
    },
    contentType: {
      type: 'text',
      sqlName: 'content_type',
      defaultValue: 'text/plain'
    },
    sequenceNumber: {
      type: 'integer',
      sqlName: 'sequence_number',
      notNull: true
    },
    createdAt: {
      type: 'timestamp',
      sqlName: 'created_at',
      notNull: true
    }
  },
  indexes: [
    {
      name: 'mls_messages_group_seq_unique',
      columns: ['groupId', 'sequenceNumber'],
      unique: true
    },
    { name: 'mls_messages_group_epoch_idx', columns: ['groupId', 'epoch'] },
    { name: 'mls_messages_created_idx', columns: ['createdAt'] }
  ]
};

/**
 * MLS welcome messages for new group members.
 * When a user is added to a group, they receive a welcome message
 * that contains the encrypted group state needed to join.
 */
export const mlsWelcomeMessagesTable: TableDefinition = {
  name: 'mls_welcome_messages',
  propertyName: 'mlsWelcomeMessages',
  comment:
    'MLS welcome messages for new group members.\nContains encrypted group state needed to join.',
  columns: {
    id: {
      type: 'text',
      sqlName: 'id',
      primaryKey: true
    },
    groupId: {
      type: 'text',
      sqlName: 'group_id',
      notNull: true,
      references: {
        table: 'mls_groups',
        column: 'id',
        onDelete: 'cascade'
      }
    },
    recipientUserId: {
      type: 'text',
      sqlName: 'recipient_user_id',
      notNull: true,
      references: {
        table: 'users',
        column: 'id',
        onDelete: 'cascade'
      }
    },
    keyPackageRef: {
      type: 'text',
      sqlName: 'key_package_ref',
      notNull: true
    },
    welcomeData: {
      type: 'text',
      sqlName: 'welcome_data',
      notNull: true
    },
    epoch: {
      type: 'integer',
      sqlName: 'epoch',
      notNull: true
    },
    createdAt: {
      type: 'timestamp',
      sqlName: 'created_at',
      notNull: true
    },
    consumedAt: {
      type: 'timestamp',
      sqlName: 'consumed_at'
    }
  },
  indexes: [
    {
      name: 'mls_welcome_recipient_idx',
      columns: ['recipientUserId', 'consumedAt']
    },
    { name: 'mls_welcome_group_idx', columns: ['groupId'] }
  ]
};

/**
 * MLS group state snapshots for recovery and multi-device sync.
 * Stores encrypted serialized MLS state at specific epochs.
 * State is encrypted client-side before upload.
 */
export const mlsGroupStateTable: TableDefinition = {
  name: 'mls_group_state',
  propertyName: 'mlsGroupState',
  comment:
    'MLS group state snapshots for recovery and multi-device sync.\nStores encrypted serialized MLS state at specific epochs.',
  columns: {
    id: {
      type: 'text',
      sqlName: 'id',
      primaryKey: true
    },
    groupId: {
      type: 'text',
      sqlName: 'group_id',
      notNull: true,
      references: {
        table: 'mls_groups',
        column: 'id',
        onDelete: 'cascade'
      }
    },
    userId: {
      type: 'text',
      sqlName: 'user_id',
      notNull: true,
      references: {
        table: 'users',
        column: 'id',
        onDelete: 'cascade'
      }
    },
    epoch: {
      type: 'integer',
      sqlName: 'epoch',
      notNull: true
    },
    encryptedState: {
      type: 'text',
      sqlName: 'encrypted_state',
      notNull: true
    },
    stateHash: {
      type: 'text',
      sqlName: 'state_hash',
      notNull: true
    },
    createdAt: {
      type: 'timestamp',
      sqlName: 'created_at',
      notNull: true
    }
  },
  indexes: [
    {
      name: 'mls_group_state_user_group_unique',
      columns: ['groupId', 'userId'],
      unique: true
    },
    { name: 'mls_group_state_epoch_idx', columns: ['groupId', 'epoch'] }
  ]
};

export const runtimeAiMlsTables: TableDefinition[] = [
  mlsKeyPackagesTable,
  mlsGroupsTable,
  mlsGroupMembersTable,
  mlsMessagesTable,
  mlsWelcomeMessagesTable,
  mlsGroupStateTable
];

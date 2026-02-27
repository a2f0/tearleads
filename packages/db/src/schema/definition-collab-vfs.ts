import type { TableDefinition } from './types.js';

// =============================================================================
// VFS (Virtual Filesystem) Tables
// =============================================================================
// Design Note: Cryptographic keys are stored as TEXT (base64-encoded) rather than
// BYTEA for the following reasons:
// 1. Cross-database compatibility: Works identically on PostgreSQL and SQLite
// 2. Human-readable in database tools for debugging and auditing
// 3. Simpler application layer: No bytea encoding/decoding required
// 4. Web API compatibility: Base64 is standard for transferring binary over JSON
// Base64 encoding adds ~33% overhead but keys are small and the benefits outweigh this.

/**
 * User cryptographic keys for VFS encryption and sharing.
 * Stores asymmetric keypairs (ML-KEM + X25519 hybrid) for key exchange.
 * All binary key data is base64-encoded before storage.
 */
export const userKeysTable: TableDefinition = {
  name: 'user_keys',
  propertyName: 'userKeys',
  comment:
    'User cryptographic keys for VFS encryption and sharing.\nStores asymmetric keypairs (ML-KEM + X25519 hybrid) for key exchange.',
  columns: {
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
    publicEncryptionKey: {
      type: 'text',
      sqlName: 'public_encryption_key',
      notNull: true
    },
    publicSigningKey: {
      type: 'text',
      sqlName: 'public_signing_key',
      notNull: true
    },
    encryptedPrivateKeys: {
      type: 'text',
      sqlName: 'encrypted_private_keys',
      notNull: true
    },
    argon2Salt: {
      type: 'text',
      sqlName: 'argon2_salt',
      notNull: true
    },
    recoveryKeyHash: {
      type: 'text',
      sqlName: 'recovery_key_hash'
    },
    createdAt: {
      type: 'timestamp',
      sqlName: 'created_at',
      notNull: true
    }
  }
};

/**
 * VFS registry - identity layer for all items that can participate in the hierarchy.
 * Every VFS item (folder, contact, photo, note, etc.) has an entry here.
 */
export const vfsRegistryTable: TableDefinition = {
  name: 'vfs_registry',
  propertyName: 'vfsRegistry',
  comment:
    'VFS registry - identity layer for all items that can participate in the hierarchy.\nEvery VFS item (folder, contact, photo, note, etc.) has an entry here.\nDevice-first: ownerId is optional and not FK-constrained to support offline creation.',
  columns: {
    id: {
      type: 'text',
      sqlName: 'id',
      primaryKey: true
    },
    objectType: {
      type: 'text',
      sqlName: 'object_type',
      notNull: true
    },
    ownerId: {
      type: 'text',
      sqlName: 'owner_id'
    },
    organizationId: {
      type: 'text',
      sqlName: 'organization_id'
    },
    encryptedSessionKey: {
      type: 'text',
      sqlName: 'encrypted_session_key'
    },
    publicHierarchicalKey: {
      type: 'text',
      sqlName: 'public_hierarchical_key'
    },
    encryptedPrivateHierarchicalKey: {
      type: 'text',
      sqlName: 'encrypted_private_hierarchical_key'
    },
    encryptedName: {
      type: 'text',
      sqlName: 'encrypted_name'
    },
    icon: {
      type: 'text',
      sqlName: 'icon'
    },
    viewMode: {
      type: 'text',
      sqlName: 'view_mode'
    },
    defaultSort: {
      type: 'text',
      sqlName: 'default_sort'
    },
    sortDirection: {
      type: 'text',
      sqlName: 'sort_direction'
    },
    createdAt: {
      type: 'timestamp',
      sqlName: 'created_at',
      notNull: true
    }
  },
  indexes: [
    { name: 'vfs_registry_owner_idx', columns: ['ownerId'] },
    { name: 'vfs_registry_type_idx', columns: ['objectType'] },
    { name: 'vfs_registry_org_idx', columns: ['organizationId'] }
  ]
};

/**
 * VFS links - flexible parent/child relationships with per-link key wrapping.
 * Enables the same item to appear in multiple folders with different visibility.
 */
export const vfsLinksTable: TableDefinition = {
  name: 'vfs_links',
  propertyName: 'vfsLinks',
  comment:
    'VFS links - flexible parent/child relationships with per-link key wrapping.\nEnables the same item to appear in multiple folders with different visibility.',
  columns: {
    id: {
      type: 'text',
      sqlName: 'id',
      primaryKey: true
    },
    parentId: {
      type: 'text',
      sqlName: 'parent_id',
      notNull: true,
      references: {
        table: 'vfs_registry',
        column: 'id',
        onDelete: 'cascade'
      }
    },
    childId: {
      type: 'text',
      sqlName: 'child_id',
      notNull: true,
      references: {
        table: 'vfs_registry',
        column: 'id',
        onDelete: 'cascade'
      }
    },
    wrappedSessionKey: {
      type: 'text',
      sqlName: 'wrapped_session_key',
      notNull: true
    },
    wrappedHierarchicalKey: {
      type: 'text',
      sqlName: 'wrapped_hierarchical_key'
    },
    visibleChildren: {
      type: 'json',
      sqlName: 'visible_children'
    },
    position: {
      type: 'integer',
      sqlName: 'position'
    },
    createdAt: {
      type: 'timestamp',
      sqlName: 'created_at',
      notNull: true
    }
  },
  indexes: [
    { name: 'vfs_links_parent_idx', columns: ['parentId'] },
    { name: 'vfs_links_child_idx', columns: ['childId'] },
    {
      name: 'vfs_links_parent_child_idx',
      columns: ['parentId', 'childId'],
      unique: true
    }
  ]
};

export const collabVfsTables: TableDefinition[] = [
  userKeysTable,
  vfsRegistryTable,
  vfsLinksTable
];

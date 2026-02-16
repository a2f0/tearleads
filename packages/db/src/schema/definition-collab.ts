import type { TableDefinition } from './types.js';
export const healthWeightReadingsTable: TableDefinition = {
  name: 'health_weight_readings',
  propertyName: 'healthWeightReadings',
  comment:
    'Health weight readings table for storing body weight measurements.\nValues are stored as centi-units to preserve decimal precision.',
  columns: {
    id: {
      type: 'text',
      sqlName: 'id',
      primaryKey: true
    },
    recordedAt: {
      type: 'timestamp',
      sqlName: 'recorded_at',
      notNull: true
    },
    valueCenti: {
      type: 'integer',
      sqlName: 'value_centi',
      notNull: true
    },
    unit: {
      type: 'text',
      sqlName: 'unit',
      notNull: true,
      defaultValue: 'lb',
      enumValues: ['lb', 'kg'] as const
    },
    note: {
      type: 'text',
      sqlName: 'note'
    },
    createdAt: {
      type: 'timestamp',
      sqlName: 'created_at',
      notNull: true
    }
  },
  indexes: [
    { name: 'health_weight_readings_recorded_at_idx', columns: ['recordedAt'] }
  ]
};

/**
 * Health blood pressure readings table for systolic/diastolic tracking.
 */
export const healthBloodPressureReadingsTable: TableDefinition = {
  name: 'health_blood_pressure_readings',
  propertyName: 'healthBloodPressureReadings',
  comment:
    'Health blood pressure readings table for systolic/diastolic tracking.',
  columns: {
    id: {
      type: 'text',
      sqlName: 'id',
      primaryKey: true
    },
    recordedAt: {
      type: 'timestamp',
      sqlName: 'recorded_at',
      notNull: true
    },
    systolic: {
      type: 'integer',
      sqlName: 'systolic',
      notNull: true
    },
    diastolic: {
      type: 'integer',
      sqlName: 'diastolic',
      notNull: true
    },
    pulse: {
      type: 'integer',
      sqlName: 'pulse'
    },
    note: {
      type: 'text',
      sqlName: 'note'
    },
    createdAt: {
      type: 'timestamp',
      sqlName: 'created_at',
      notNull: true
    }
  },
  indexes: [
    {
      name: 'health_blood_pressure_recorded_at_idx',
      columns: ['recordedAt']
    }
  ]
};

/**
 * Health workout entries table for exercise, reps, and weight tracking.
 * Weight values are stored as centi-units to preserve decimal precision.
 */
export const healthWorkoutEntriesTable: TableDefinition = {
  name: 'health_workout_entries',
  propertyName: 'healthWorkoutEntries',
  comment:
    'Health workout entries table for exercise, reps, and weight tracking.\nWeight values are stored as centi-units to preserve decimal precision.',
  columns: {
    id: {
      type: 'text',
      sqlName: 'id',
      primaryKey: true
    },
    performedAt: {
      type: 'timestamp',
      sqlName: 'performed_at',
      notNull: true
    },
    exerciseId: {
      type: 'text',
      sqlName: 'exercise_id',
      notNull: true,
      references: {
        table: 'health_exercises',
        column: 'id',
        onDelete: 'restrict'
      }
    },
    reps: {
      type: 'integer',
      sqlName: 'reps',
      notNull: true
    },
    weightCenti: {
      type: 'integer',
      sqlName: 'weight_centi',
      notNull: true
    },
    weightUnit: {
      type: 'text',
      sqlName: 'weight_unit',
      notNull: true,
      defaultValue: 'lb',
      enumValues: ['lb', 'kg'] as const
    },
    note: {
      type: 'text',
      sqlName: 'note'
    },
    createdAt: {
      type: 'timestamp',
      sqlName: 'created_at',
      notNull: true
    }
  },
  indexes: [
    {
      name: 'health_workout_entries_performed_at_idx',
      columns: ['performedAt']
    },
    { name: 'health_workout_entries_exercise_idx', columns: ['exerciseId'] }
  ]
};

/**
 * Groups table for organizing users into named groups.
 */
export const groupsTable: TableDefinition = {
  name: 'groups',
  propertyName: 'groups',
  comment: 'Groups table for organizing users into named groups.',
  columns: {
    id: {
      type: 'text',
      sqlName: 'id',
      primaryKey: true
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
    name: {
      type: 'text',
      sqlName: 'name',
      notNull: true
    },
    description: {
      type: 'text',
      sqlName: 'description'
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
      name: 'groups_org_name_idx',
      columns: ['organizationId', 'name'],
      unique: true
    },
    { name: 'groups_org_idx', columns: ['organizationId'] }
  ]
};

/**
 * Junction table for many-to-many relationship between users and groups.
 */
export const userGroupsTable: TableDefinition = {
  name: 'user_groups',
  propertyName: 'userGroups',
  comment:
    'Junction table for many-to-many relationship between users and groups.',
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
    groupId: {
      type: 'text',
      sqlName: 'group_id',
      primaryKey: true,
      references: {
        table: 'groups',
        column: 'id',
        onDelete: 'cascade'
      }
    },
    joinedAt: {
      type: 'timestamp',
      sqlName: 'joined_at',
      notNull: true
    }
  },
  indexes: [{ name: 'user_groups_group_idx', columns: ['groupId'] }]
};

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
    { name: 'vfs_registry_type_idx', columns: ['objectType'] }
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

/**
 * Playlists - extends registry for playlist-type items.
 * Stores encrypted playlist metadata.
 */
export const playlistsTable: TableDefinition = {
  name: 'playlists',
  propertyName: 'playlists',
  comment:
    'Playlists - extends registry for playlist-type items.\nStores encrypted playlist metadata.',
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
    encryptedDescription: {
      type: 'text',
      sqlName: 'encrypted_description'
    },
    coverImageId: {
      type: 'text',
      sqlName: 'cover_image_id',
      references: {
        table: 'vfs_registry',
        column: 'id',
        onDelete: 'set null'
      }
    },
    shuffleMode: {
      type: 'integer',
      sqlName: 'shuffle_mode',
      notNull: true,
      defaultValue: 0
    },
    mediaType: {
      type: 'text',
      sqlName: 'media_type',
      notNull: true,
      defaultValue: 'audio',
      enumValues: ['audio', 'video'] as const
    }
  }
};

/**
 * Albums - extends registry for album-type items.
 * Stores encrypted album metadata for photo collections.
 */
export const albumsTable: TableDefinition = {
  name: 'albums',
  propertyName: 'albums',
  comment:
    'Albums - extends registry for album-type items.\nStores encrypted album metadata for photo collections.',
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
    encryptedDescription: {
      type: 'text',
      sqlName: 'encrypted_description'
    },
    coverPhotoId: {
      type: 'text',
      sqlName: 'cover_photo_id',
      references: {
        table: 'vfs_registry',
        column: 'id',
        onDelete: 'set null'
      }
    },
    albumType: {
      type: 'text',
      sqlName: 'album_type',
      enumValues: ['photoroll', 'custom'] as const,
      notNull: true,
      defaultValue: 'custom'
    }
  }
};

/**
 * Contact groups - extends registry for contactGroup-type items.
 * Stores encrypted contact group metadata.
 */

export const collabTables: TableDefinition[] = [
  healthWeightReadingsTable,
  healthBloodPressureReadingsTable,
  healthWorkoutEntriesTable,
  groupsTable,
  userGroupsTable,
  userKeysTable,
  vfsRegistryTable,
  vfsLinksTable,
  playlistsTable,
  albumsTable
];

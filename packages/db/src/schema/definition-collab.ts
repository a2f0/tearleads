import type { TableDefinition } from './types.js';

// Re-export from split modules
export {
  collabHealthTables,
  healthBloodPressureReadingsTable,
  healthWeightReadingsTable,
  healthWorkoutEntriesTable
} from './definition-collab-health.js';

export {
  collabVfsTables,
  userKeysTable,
  vfsLinksTable,
  vfsRegistryTable
} from './definition-collab-vfs.js';

// Import for combining into collabTables
import { collabHealthTables } from './definition-collab-health.js';
import { collabVfsTables } from './definition-collab-vfs.js';

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

export const collabTables: TableDefinition[] = [
  ...collabHealthTables,
  groupsTable,
  userGroupsTable,
  ...collabVfsTables,
  playlistsTable,
  albumsTable
];

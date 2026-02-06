import { vfsFolders, vfsLinks, vfsRegistry } from '@rapid/db/sqlite';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { withRealDatabase } from '../with-real-database.js';
import {
  ensureVfsRoot,
  seedFolder,
  seedVfsItem,
  seedVfsLink,
  VFS_ROOT_ID
} from './vfs.js';

// Simple migration to create VFS tables
const vfsMigrations = [
  {
    version: 1,
    up: async (adapter: { execute: (sql: string) => Promise<void> }) => {
      await adapter.execute(`
        CREATE TABLE IF NOT EXISTS vfs_registry (
          id TEXT PRIMARY KEY,
          object_type TEXT NOT NULL,
          owner_id TEXT,
          encrypted_session_key TEXT,
          public_hierarchical_key TEXT,
          encrypted_private_hierarchical_key TEXT,
          created_at INTEGER NOT NULL
        )
      `);
      await adapter.execute(`
        CREATE TABLE IF NOT EXISTS vfs_folders (
          id TEXT PRIMARY KEY REFERENCES vfs_registry(id) ON DELETE CASCADE,
          encrypted_name TEXT,
          icon TEXT,
          view_mode TEXT,
          default_sort TEXT,
          sort_direction TEXT
        )
      `);
      await adapter.execute(`
        CREATE TABLE IF NOT EXISTS vfs_links (
          id TEXT PRIMARY KEY,
          parent_id TEXT NOT NULL REFERENCES vfs_registry(id) ON DELETE CASCADE,
          child_id TEXT NOT NULL REFERENCES vfs_registry(id) ON DELETE CASCADE,
          wrapped_session_key TEXT NOT NULL,
          wrapped_hierarchical_key TEXT,
          visible_children TEXT,
          position INTEGER,
          created_at INTEGER NOT NULL
        )
      `);
      // Enable foreign keys
      await adapter.execute('PRAGMA foreign_keys = ON');
    }
  }
];

describe('VFS_ROOT_ID', () => {
  it('is a well-known UUID', () => {
    expect(VFS_ROOT_ID).toBe('00000000-0000-0000-0000-000000000000');
  });
});

describe('ensureVfsRoot', () => {
  it('creates VFS root if not exists', async () => {
    await withRealDatabase(
      async ({ db }) => {
        await ensureVfsRoot(db);

        const registry = await db
          .select()
          .from(vfsRegistry)
          .where(eq(vfsRegistry.id, VFS_ROOT_ID));
        expect(registry.length).toBe(1);
        expect(registry[0]?.objectType).toBe('folder');

        const folder = await db
          .select()
          .from(vfsFolders)
          .where(eq(vfsFolders.id, VFS_ROOT_ID));
        expect(folder.length).toBe(1);
      },
      { migrations: vfsMigrations }
    );
  });

  it('is idempotent', async () => {
    await withRealDatabase(
      async ({ db }) => {
        await ensureVfsRoot(db);
        await ensureVfsRoot(db);

        const registry = await db
          .select()
          .from(vfsRegistry)
          .where(eq(vfsRegistry.id, VFS_ROOT_ID));
        expect(registry.length).toBe(1);
      },
      { migrations: vfsMigrations }
    );
  });
});

describe('seedFolder', () => {
  it('creates folder with default options', async () => {
    await withRealDatabase(
      async ({ db }) => {
        const folderId = await seedFolder(db);

        const registry = await db
          .select()
          .from(vfsRegistry)
          .where(eq(vfsRegistry.id, folderId));
        expect(registry.length).toBe(1);
        expect(registry[0]?.objectType).toBe('folder');

        const folder = await db
          .select()
          .from(vfsFolders)
          .where(eq(vfsFolders.id, folderId));
        expect(folder.length).toBe(1);

        const links = await db
          .select()
          .from(vfsLinks)
          .where(eq(vfsLinks.childId, folderId));
        expect(links.length).toBe(1);
        expect(links[0]?.parentId).toBe(VFS_ROOT_ID);
      },
      { migrations: vfsMigrations }
    );
  });

  it('respects custom id', async () => {
    await withRealDatabase(
      async ({ db }) => {
        const customId = 'custom-folder-id';
        const folderId = await seedFolder(db, { id: customId });

        expect(folderId).toBe(customId);
      },
      { migrations: vfsMigrations }
    );
  });

  it('respects custom name', async () => {
    await withRealDatabase(
      async ({ db }) => {
        const folderId = await seedFolder(db, { name: 'My Custom Folder' });

        const folder = await db
          .select()
          .from(vfsFolders)
          .where(eq(vfsFolders.id, folderId));
        expect(folder[0]?.encryptedName).toBe('My Custom Folder');
      },
      { migrations: vfsMigrations }
    );
  });

  it('respects custom parentId', async () => {
    await withRealDatabase(
      async ({ db }) => {
        const parentId = await seedFolder(db, { name: 'Parent' });
        const childId = await seedFolder(db, {
          name: 'Child',
          parentId
        });

        const links = await db
          .select()
          .from(vfsLinks)
          .where(eq(vfsLinks.childId, childId));
        expect(links[0]?.parentId).toBe(parentId);
      },
      { migrations: vfsMigrations }
    );
  });

  it('sets icon when provided', async () => {
    await withRealDatabase(
      async ({ db }) => {
        const folderId = await seedFolder(db, { icon: 'star' });

        const folder = await db
          .select()
          .from(vfsFolders)
          .where(eq(vfsFolders.id, folderId));
        expect(folder[0]?.icon).toBe('star');
      },
      { migrations: vfsMigrations }
    );
  });

  it('sets viewMode when provided', async () => {
    await withRealDatabase(
      async ({ db }) => {
        const folderId = await seedFolder(db, { viewMode: 'grid' });

        const folder = await db
          .select()
          .from(vfsFolders)
          .where(eq(vfsFolders.id, folderId));
        expect(folder[0]?.viewMode).toBe('grid');
      },
      { migrations: vfsMigrations }
    );
  });
});

describe('seedVfsItem', () => {
  it('creates registry item with specified type', async () => {
    await withRealDatabase(
      async ({ db }) => {
        const itemId = await seedVfsItem(db, { objectType: 'file' });

        const registry = await db
          .select()
          .from(vfsRegistry)
          .where(eq(vfsRegistry.id, itemId));
        expect(registry.length).toBe(1);
        expect(registry[0]?.objectType).toBe('file');
      },
      { migrations: vfsMigrations }
    );
  });

  it('creates link when parentId is provided', async () => {
    await withRealDatabase(
      async ({ db }) => {
        const folderId = await seedFolder(db);
        const itemId = await seedVfsItem(db, {
          objectType: 'file',
          parentId: folderId
        });

        const links = await db
          .select()
          .from(vfsLinks)
          .where(eq(vfsLinks.childId, itemId));
        expect(links.length).toBe(1);
        expect(links[0]?.parentId).toBe(folderId);
      },
      { migrations: vfsMigrations }
    );
  });

  it('does not create link when createLink is false', async () => {
    await withRealDatabase(
      async ({ db }) => {
        const folderId = await seedFolder(db);
        const itemId = await seedVfsItem(db, {
          objectType: 'file',
          parentId: folderId,
          createLink: false
        });

        const links = await db
          .select()
          .from(vfsLinks)
          .where(eq(vfsLinks.childId, itemId));
        expect(links.length).toBe(0);
      },
      { migrations: vfsMigrations }
    );
  });

  it('respects custom id', async () => {
    await withRealDatabase(
      async ({ db }) => {
        const customId = 'custom-item-id';
        const itemId = await seedVfsItem(db, {
          objectType: 'file',
          id: customId
        });

        expect(itemId).toBe(customId);
      },
      { migrations: vfsMigrations }
    );
  });

  it('sets ownerId when provided', async () => {
    await withRealDatabase(
      async ({ db }) => {
        const itemId = await seedVfsItem(db, {
          objectType: 'file',
          ownerId: 'user-123'
        });

        const registry = await db
          .select()
          .from(vfsRegistry)
          .where(eq(vfsRegistry.id, itemId));
        expect(registry[0]?.ownerId).toBe('user-123');
      },
      { migrations: vfsMigrations }
    );
  });
});

describe('seedVfsLink', () => {
  it('creates link between items', async () => {
    await withRealDatabase(
      async ({ db }) => {
        const parentId = await seedFolder(db);
        const childId = await seedVfsItem(db, {
          objectType: 'file',
          createLink: false
        });

        const linkId = await seedVfsLink(db, { parentId, childId });

        const links = await db
          .select()
          .from(vfsLinks)
          .where(eq(vfsLinks.id, linkId));
        expect(links.length).toBe(1);
        expect(links[0]?.parentId).toBe(parentId);
        expect(links[0]?.childId).toBe(childId);
      },
      { migrations: vfsMigrations }
    );
  });

  it('respects custom id', async () => {
    await withRealDatabase(
      async ({ db }) => {
        const parentId = await seedFolder(db);
        const childId = await seedVfsItem(db, {
          objectType: 'file',
          createLink: false
        });
        const customId = 'custom-link-id';

        const linkId = await seedVfsLink(db, {
          parentId,
          childId,
          id: customId
        });

        expect(linkId).toBe(customId);
      },
      { migrations: vfsMigrations }
    );
  });
});

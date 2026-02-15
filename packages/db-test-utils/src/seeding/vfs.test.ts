import { vfsLinks, vfsRegistry } from '@tearleads/db/sqlite';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { withRealDatabase } from '../withRealDatabase.js';
import {
  ensureVfsRoot,
  seedFolder,
  seedVfsItem,
  seedVfsLink,
  VFS_ROOT_ID
} from './vfs.js';
import { vfsTestMigrations } from './vfsTestMigrations.js';

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
        expect(registry[0]?.encryptedName).toBe('VFS Root');
      },
      { migrations: vfsTestMigrations }
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
      { migrations: vfsTestMigrations }
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

        const links = await db
          .select()
          .from(vfsLinks)
          .where(eq(vfsLinks.childId, folderId));
        expect(links.length).toBe(1);
        expect(links[0]?.parentId).toBe(VFS_ROOT_ID);
      },
      { migrations: vfsTestMigrations }
    );
  });

  it('respects custom id', async () => {
    await withRealDatabase(
      async ({ db }) => {
        const customId = 'custom-folder-id';
        const folderId = await seedFolder(db, { id: customId });

        expect(folderId).toBe(customId);
      },
      { migrations: vfsTestMigrations }
    );
  });

  it('respects custom name', async () => {
    await withRealDatabase(
      async ({ db }) => {
        const folderId = await seedFolder(db, { name: 'My Custom Folder' });

        const registry = await db
          .select()
          .from(vfsRegistry)
          .where(eq(vfsRegistry.id, folderId));
        expect(registry[0]?.encryptedName).toBe('My Custom Folder');
      },
      { migrations: vfsTestMigrations }
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
      { migrations: vfsTestMigrations }
    );
  });

  it('sets icon when provided', async () => {
    await withRealDatabase(
      async ({ db }) => {
        const folderId = await seedFolder(db, { icon: 'star' });

        const registry = await db
          .select()
          .from(vfsRegistry)
          .where(eq(vfsRegistry.id, folderId));
        expect(registry[0]?.icon).toBe('star');
      },
      { migrations: vfsTestMigrations }
    );
  });

  it('sets viewMode when provided', async () => {
    await withRealDatabase(
      async ({ db }) => {
        const folderId = await seedFolder(db, { viewMode: 'grid' });

        const registry = await db
          .select()
          .from(vfsRegistry)
          .where(eq(vfsRegistry.id, folderId));
        expect(registry[0]?.viewMode).toBe('grid');
      },
      { migrations: vfsTestMigrations }
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
      { migrations: vfsTestMigrations }
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
      { migrations: vfsTestMigrations }
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
      { migrations: vfsTestMigrations }
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
      { migrations: vfsTestMigrations }
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
      { migrations: vfsTestMigrations }
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
      { migrations: vfsTestMigrations }
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
      { migrations: vfsTestMigrations }
    );
  });
});

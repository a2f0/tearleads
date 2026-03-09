import { vfsLinks, vfsRegistry } from '@tearleads/db/sqlite';
import { vfsTestMigrations, withRealDatabase } from '@tearleads/db-test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { linkContactsToGroup } from './linkContactsToGroup';

describe('linkContactsToGroup', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers missing contacts in VFS and links to group', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await withRealDatabase(
      async ({ db }) => {
        const now = new Date();

        await db.insert(vfsRegistry).values({
          id: 'group-1',
          objectType: 'contactGroup',
          ownerId: null,
          createdAt: now
        });

        const insertedCount = await linkContactsToGroup(db, 'group-1', [
          'contact-1'
        ]);
        expect(insertedCount).toBe(1);

        const contactRegistryRows = await db
          .select({ id: vfsRegistry.id, objectType: vfsRegistry.objectType })
          .from(vfsRegistry)
          .where(eq(vfsRegistry.id, 'contact-1'));
        expect(contactRegistryRows).toHaveLength(1);
        expect(contactRegistryRows[0]?.objectType).toBe('contact');

        const linksAfterFirstDrop = await db
          .select({ id: vfsLinks.id })
          .from(vfsLinks)
          .where(eq(vfsLinks.parentId, 'group-1'));
        expect(linksAfterFirstDrop).toHaveLength(1);

        const duplicateInsertedCount = await linkContactsToGroup(
          db,
          'group-1',
          ['contact-1']
        );
        expect(duplicateInsertedCount).toBe(0);

        const linksAfterSecondDrop = await db
          .select({ id: vfsLinks.id })
          .from(vfsLinks)
          .where(eq(vfsLinks.parentId, 'group-1'));
        expect(linksAfterSecondDrop).toHaveLength(1);
      },
      { migrations: vfsTestMigrations }
    );
  });
});

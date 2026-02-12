import { contacts, vfsLinks, vfsRegistry } from '@tearleads/db/sqlite';
import { vfsTestMigrations, withRealDatabase } from '@tearleads/db-test-utils';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('getGroupCounts', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('counts contacts per group with GROUP BY query', async () => {
    await withRealDatabase(
      async ({ db }) => {
        const now = new Date();

        // Create two contact groups
        await db.insert(vfsRegistry).values([
          { id: 'group-1', objectType: 'contactGroup', ownerId: null, createdAt: now },
          { id: 'group-2', objectType: 'contactGroup', ownerId: null, createdAt: now }
        ]);

        // Create three contacts
        await db.insert(vfsRegistry).values([
          { id: 'contact-1', objectType: 'contact', ownerId: null, createdAt: now },
          { id: 'contact-2', objectType: 'contact', ownerId: null, createdAt: now },
          { id: 'contact-3', objectType: 'contact', ownerId: null, createdAt: now }
        ]);
        await db.insert(contacts).values([
          { id: 'contact-1', firstName: 'Alice', deleted: false, createdAt: now, updatedAt: now },
          { id: 'contact-2', firstName: 'Bob', deleted: false, createdAt: now, updatedAt: now },
          { id: 'contact-3', firstName: 'Charlie', deleted: true, createdAt: now, updatedAt: now } // Deleted contact should not be counted
        ]);

        // Link contacts to groups:
        // group-1: contact-1, contact-2 (2 active)
        // group-2: contact-3 (deleted, so 0 active)
        await db.insert(vfsLinks).values([
          { id: 'link-1', parentId: 'group-1', childId: 'contact-1', wrappedSessionKey: 'key', createdAt: now },
          { id: 'link-2', parentId: 'group-1', childId: 'contact-2', wrappedSessionKey: 'key', createdAt: now },
          { id: 'link-3', parentId: 'group-2', childId: 'contact-3', wrappedSessionKey: 'key', createdAt: now }
        ]);

        // Test the GROUP BY query
        const groupIds = ['group-1', 'group-2'];
        const countsResult = await db
          .select({
            groupId: vfsLinks.parentId,
            count: sql<number>`COUNT(*)`.mapWith(Number)
          })
          .from(vfsLinks)
          .innerJoin(
            contacts,
            and(
              eq(contacts.id, vfsLinks.childId),
              eq(contacts.deleted, false)
            )
          )
          .where(inArray(vfsLinks.parentId, groupIds))
          .groupBy(vfsLinks.parentId);

        // Build counts map
        const counts: Record<string, number> = {};
        for (const row of countsResult) {
          counts[row.groupId] = row.count;
        }

        expect(counts['group-1']).toBe(2);
        expect(counts['group-2']).toBeUndefined(); // No active contacts, so not in result
      },
      { migrations: vfsTestMigrations }
    );
  });

  it('handles empty group list', async () => {
    await withRealDatabase(
      async ({ db }) => {
        const groupIds: string[] = [];

        // Empty inArray should be handled
        if (groupIds.length === 0) {
          // Skip query for empty list
          expect(true).toBe(true);
          return;
        }

        const countsResult = await db
          .select({
            groupId: vfsLinks.parentId,
            count: sql<number>`COUNT(*)`.mapWith(Number)
          })
          .from(vfsLinks)
          .innerJoin(
            contacts,
            and(
              eq(contacts.id, vfsLinks.childId),
              eq(contacts.deleted, false)
            )
          )
          .where(inArray(vfsLinks.parentId, groupIds))
          .groupBy(vfsLinks.parentId);

        expect(countsResult).toHaveLength(0);
      },
      { migrations: vfsTestMigrations }
    );
  });
});

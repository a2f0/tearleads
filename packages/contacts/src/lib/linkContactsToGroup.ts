import { vfsLinks, vfsRegistry, type Database } from '@rapid/db/sqlite';
import { and, eq, inArray } from 'drizzle-orm';

export async function linkContactsToGroup(
  db: Database,
  groupId: string,
  contactIds: string[]
): Promise<number> {
  const uniqueContactIds = Array.from(new Set(contactIds.filter(Boolean)));
  if (uniqueContactIds.length === 0) {
    return 0;
  }

  const now = new Date();

  await db
    .insert(vfsRegistry)
    .values(
      uniqueContactIds.map((contactId) => ({
        id: contactId,
        objectType: 'contact',
        ownerId: null,
        createdAt: now
      }))
    )
    .onConflictDoNothing({ target: vfsRegistry.id });

  const existingLinks = await db
    .select({ childId: vfsLinks.childId })
    .from(vfsLinks)
    .where(
      and(
        eq(vfsLinks.parentId, groupId),
        inArray(vfsLinks.childId, uniqueContactIds)
      )
    );

  const existingChildIds = new Set(existingLinks.map((link) => link.childId));
  const linksToInsert = uniqueContactIds
    .filter((contactId) => !existingChildIds.has(contactId))
    .map((contactId) => ({
      id: crypto.randomUUID(),
      parentId: groupId,
      childId: contactId,
      wrappedSessionKey: '',
      createdAt: now
    }));

  if (linksToInsert.length === 0) {
    return 0;
  }

  await db
    .insert(vfsLinks)
    .values(linksToInsert)
    .onConflictDoNothing({ target: [vfsLinks.parentId, vfsLinks.childId] });

  return linksToInsert.length;
}

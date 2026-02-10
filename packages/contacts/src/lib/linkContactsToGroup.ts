import { type Database, vfsLinks, vfsRegistry } from '@rapid/db/sqlite';
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

  const run = async (tx: Database): Promise<number> => {
    const now = new Date();

    const existingRegistryRows = await tx
      .select({ id: vfsRegistry.id })
      .from(vfsRegistry)
      .where(inArray(vfsRegistry.id, uniqueContactIds));
    const existingRegistryIds = new Set(
      existingRegistryRows.map((row) => row.id)
    );
    const missingRegistryIds = uniqueContactIds.filter(
      (contactId) => !existingRegistryIds.has(contactId)
    );
    if (missingRegistryIds.length > 0) {
      await tx.insert(vfsRegistry).values(
        missingRegistryIds.map((contactId) => ({
          id: contactId,
          objectType: 'contact',
          ownerId: null,
          createdAt: now
        }))
      );
    }

    const existingLinks = await tx
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

    await tx.insert(vfsLinks).values(linksToInsert);

    return linksToInsert.length;
  };

  if (typeof db.transaction === 'function') {
    return db.transaction(run);
  }

  return run(db);
}

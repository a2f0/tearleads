import { type Database, vfsLinks, vfsRegistry } from '@rapid/db/sqlite';
import { and, eq, inArray } from 'drizzle-orm';

export async function linkAudioToPlaylist(
  db: Database,
  playlistId: string,
  audioIds: string[]
): Promise<number> {
  const uniqueAudioIds = Array.from(new Set(audioIds.filter(Boolean)));
  if (uniqueAudioIds.length === 0) {
    return 0;
  }

  const now = new Date();

  await db
    .insert(vfsRegistry)
    .values(
      uniqueAudioIds.map((audioId) => ({
        id: audioId,
        objectType: 'file',
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
        eq(vfsLinks.parentId, playlistId),
        inArray(vfsLinks.childId, uniqueAudioIds)
      )
    );

  const existingChildIds = new Set(existingLinks.map((link) => link.childId));
  const linksToInsert = uniqueAudioIds
    .filter((audioId) => !existingChildIds.has(audioId))
    .map((audioId) => ({
      id: crypto.randomUUID(),
      parentId: playlistId,
      childId: audioId,
      wrappedSessionKey: '',
      createdAt: now
    }));

  if (linksToInsert.length === 0) {
    return 0;
  }

  await db.insert(vfsLinks).values(linksToInsert);

  return linksToInsert.length;
}

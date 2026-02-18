import { type Database, vfsLinks, vfsRegistry } from '@tearleads/db/sqlite';
import { and, eq, inArray } from 'drizzle-orm';
import { runLocalWrite } from '@/db/localWrite';

export async function linkAudioToPlaylist(
  db: Database,
  playlistId: string,
  audioIds: string[]
): Promise<number> {
  const uniqueAudioIds = Array.from(new Set(audioIds.filter(Boolean)));
  if (uniqueAudioIds.length === 0) {
    return 0;
  }

  const run = async (
    tx: Pick<Database, 'select' | 'insert'>
  ): Promise<number> => {
    const now = new Date();

    const existingRegistryRows = await tx
      .select({ id: vfsRegistry.id })
      .from(vfsRegistry)
      .where(inArray(vfsRegistry.id, uniqueAudioIds));
    const existingRegistryIds = new Set(
      existingRegistryRows.map((row) => row.id)
    );
    const missingRegistryIds = uniqueAudioIds.filter(
      (audioId) => !existingRegistryIds.has(audioId)
    );
    if (missingRegistryIds.length > 0) {
      await tx.insert(vfsRegistry).values(
        missingRegistryIds.map((audioId) => ({
          id: audioId,
          objectType: 'file',
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

    await tx.insert(vfsLinks).values(linksToInsert);

    return linksToInsert.length;
  };

  if (typeof db.transaction === 'function') {
    return runLocalWrite(async () => db.transaction(async (tx) => run(tx)), {
      scope: 'vfs-links'
    });
  }

  return runLocalWrite(async () => run(db), { scope: 'vfs-links' });
}

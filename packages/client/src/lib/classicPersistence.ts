import {
  buildClassicPositionUpdates,
  buildClassicStateFromVfs,
  type ClassicState,
  type VfsLinkLikeRow
} from '@rapid/classic';
import { and, eq, inArray } from 'drizzle-orm';
import { getDatabase } from '@/db';
import { notes, tags, vfsLinks, vfsRegistry } from '@/db/schema';

export const CLASSIC_TAG_PARENT_ID = '__vfs_root__';

export const CLASSIC_EMPTY_STATE: ClassicState = {
  tags: [],
  notesById: {},
  noteOrderByTagId: {},
  activeTagId: null
};

export interface LoadedClassicState {
  state: ClassicState;
  linkRows: VfsLinkLikeRow[];
}

export async function loadClassicStateFromDatabase(): Promise<LoadedClassicState> {
  const db = getDatabase();

  const [registryRows, tagRows, noteRows, linkRows] = await Promise.all([
    db
      .select({
        id: vfsRegistry.id,
        objectType: vfsRegistry.objectType
      })
      .from(vfsRegistry)
      .where(inArray(vfsRegistry.objectType, ['tag', 'note'])),
    db
      .select({
        id: tags.id,
        encryptedName: tags.encryptedName
      })
      .from(tags),
    db
      .select({
        id: notes.id,
        title: notes.title,
        content: notes.content
      })
      .from(notes)
      .where(eq(notes.deleted, false)),
    db
      .select({
        parentId: vfsLinks.parentId,
        childId: vfsLinks.childId,
        position: vfsLinks.position
      })
      .from(vfsLinks)
  ]);

  const state = buildClassicStateFromVfs({
    rootTagParentId: CLASSIC_TAG_PARENT_ID,
    registryRows,
    tagRows,
    noteRows,
    linkRows
  });

  return {
    state,
    linkRows
  };
}

export async function persistClassicOrderToDatabase(
  state: ClassicState,
  currentLinkRows: readonly VfsLinkLikeRow[]
): Promise<VfsLinkLikeRow[]> {
  const updates = buildClassicPositionUpdates(
    state,
    CLASSIC_TAG_PARENT_ID,
    currentLinkRows
  );

  if (updates.length === 0) {
    return [...currentLinkRows];
  }

  const db = getDatabase();

  await Promise.all(
    updates.map((update) =>
      db
        .update(vfsLinks)
        .set({ position: update.position })
        .where(
          and(
            eq(vfsLinks.parentId, update.parentId),
            eq(vfsLinks.childId, update.childId)
          )
        )
    )
  );

  const updateLookup = new Map(
    updates.map((update) => [
      `${update.parentId}::${update.childId}`,
      update.position
    ])
  );

  return currentLinkRows.map((row) => {
    const nextPosition = updateLookup.get(`${row.parentId}::${row.childId}`);
    if (nextPosition === undefined) {
      return row;
    }
    return {
      ...row,
      position: nextPosition
    };
  });
}

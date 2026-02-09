import {
  buildClassicPositionUpdates,
  buildClassicStateFromVfs,
  type ClassicState,
  DEFAULT_CLASSIC_NOTE_TITLE,
  DEFAULT_CLASSIC_TAG_NAME,
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

  await db.transaction(async (tx) => {
    await Promise.all(
      updates.map((update) =>
        tx
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
  });

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

async function getNextChildPosition(parentId: string): Promise<number> {
  const db = getDatabase();
  const rows = await db
    .select({ position: vfsLinks.position })
    .from(vfsLinks)
    .where(eq(vfsLinks.parentId, parentId));

  const maxPosition = rows.reduce((max, row) => {
    if (row.position === null) {
      return max;
    }
    return Math.max(max, row.position);
  }, -1);

  return maxPosition + 1;
}

export async function createClassicTag(
  name: string = DEFAULT_CLASSIC_TAG_NAME
): Promise<string> {
  const db = getDatabase();
  const tagId = crypto.randomUUID();
  const linkId = crypto.randomUUID();
  const now = new Date();
  const nextPosition = await getNextChildPosition(CLASSIC_TAG_PARENT_ID);

  await db.transaction(async (tx) => {
    await tx.insert(vfsRegistry).values({
      id: tagId,
      objectType: 'tag',
      ownerId: null,
      createdAt: now
    });

    await tx.insert(tags).values({
      id: tagId,
      encryptedName: name,
      color: null,
      icon: null
    });

    await tx.insert(vfsLinks).values({
      id: linkId,
      parentId: CLASSIC_TAG_PARENT_ID,
      childId: tagId,
      wrappedSessionKey: '',
      position: nextPosition,
      createdAt: now
    });
  });

  return tagId;
}

export async function createClassicNote(
  tagId: string,
  title: string = DEFAULT_CLASSIC_NOTE_TITLE
): Promise<string> {
  const db = getDatabase();
  const noteId = crypto.randomUUID();
  const linkId = crypto.randomUUID();
  const now = new Date();
  const nextPosition = await getNextChildPosition(tagId);

  await db.transaction(async (tx) => {
    await tx.insert(vfsRegistry).values({
      id: noteId,
      objectType: 'note',
      ownerId: null,
      createdAt: now
    });

    await tx.insert(notes).values({
      id: noteId,
      title,
      content: '',
      createdAt: now,
      updatedAt: now,
      deleted: false
    });

    await tx.insert(vfsLinks).values({
      id: linkId,
      parentId: tagId,
      childId: noteId,
      wrappedSessionKey: '',
      position: nextPosition,
      createdAt: now
    });
  });

  return noteId;
}

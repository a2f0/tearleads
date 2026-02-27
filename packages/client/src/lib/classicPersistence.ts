import {
  buildClassicPositionUpdates,
  buildClassicStateFromVfs,
  type ClassicState,
  DEFAULT_CLASSIC_NOTE_TITLE,
  DEFAULT_CLASSIC_TAG_NAME,
  type VfsLinkLikeRow
} from '@tearleads/classic';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { getDatabase } from '@/db';
import { runLocalWrite } from '@/db/localWrite';
import { notes, tags, vfsLinks, vfsRegistry } from '@/db/schema';
import {
  queueItemDeleteAndFlush,
  queueItemUpsertAndFlush
} from '@/lib/vfsItemSyncWriter';

export const CLASSIC_TAG_PARENT_ID = '__vfs_root__';

export const CLASSIC_EMPTY_STATE: ClassicState = {
  tags: [],
  deletedTags: [],
  notesById: {},
  noteOrderByTagId: {},
  activeTagId: null
};

interface LoadedClassicState {
  state: ClassicState;
  linkRows: VfsLinkLikeRow[];
}

export async function loadClassicStateFromDatabase(
  organizationId?: string | null
): Promise<LoadedClassicState> {
  const db = getDatabase();

  const orgCondition = organizationId
    ? and(
        inArray(vfsRegistry.objectType, ['tag', 'note']),
        or(
          eq(vfsRegistry.organizationId, organizationId),
          isNull(vfsRegistry.organizationId)
        )
      )
    : inArray(vfsRegistry.objectType, ['tag', 'note']);

  const [registryRows, tagRows, noteRows, linkRows] = await Promise.all([
    db
      .select({
        id: vfsRegistry.id,
        objectType: vfsRegistry.objectType,
        createdAt: vfsRegistry.createdAt
      })
      .from(vfsRegistry)
      .where(orgCondition),
    db
      .select({
        id: tags.id,
        encryptedName: tags.encryptedName,
        deleted: tags.deleted
      })
      .from(tags),
    db
      .select({
        id: notes.id,
        title: notes.title,
        content: notes.content,
        createdAt: notes.createdAt,
        updatedAt: notes.updatedAt
      })
      .from(notes)
      .where(eq(notes.deleted, false)),
    db
      .select({
        parentId: vfsLinks.parentId,
        childId: vfsLinks.childId,
        position: vfsLinks.position,
        createdAt: vfsLinks.createdAt
      })
      .from(vfsLinks)
  ]);

  // Filter link rows to only include links whose parent/child are in the filtered registry set
  const registryIds = new Set(registryRows.map((r) => r.id));
  const filteredLinkRows = organizationId
    ? linkRows.filter(
        (link) =>
          (registryIds.has(link.parentId) ||
            link.parentId === CLASSIC_TAG_PARENT_ID) &&
          registryIds.has(link.childId)
      )
    : linkRows;

  const state = buildClassicStateFromVfs({
    rootTagParentId: CLASSIC_TAG_PARENT_ID,
    registryRows,
    tagRows,
    noteRows,
    linkRows: filteredLinkRows
  });

  return {
    state,
    linkRows: filteredLinkRows
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
  const targetedUpdates = updates.map((update) => {
    const condition = and(
      eq(vfsLinks.parentId, update.parentId),
      eq(vfsLinks.childId, update.childId)
    );
    return { condition, position: update.position };
  });
  const positionCaseExpression = sql<number>`CASE ${sql.join(
    targetedUpdates.map(
      ({ condition, position }) => sql`WHEN ${condition} THEN ${position}`
    ),
    sql` `
  )} ELSE ${vfsLinks.position} END`;

  await runLocalWrite(async () => {
    await db
      .update(vfsLinks)
      .set({ position: positionCaseExpression })
      .where(or(...targetedUpdates.map(({ condition }) => condition)));
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
  name: string = DEFAULT_CLASSIC_TAG_NAME,
  tagId: string = crypto.randomUUID(),
  organizationId?: string | null
): Promise<string> {
  const db = getDatabase();
  const linkId = crypto.randomUUID();
  const now = new Date();
  const nextPosition = await getNextChildPosition(CLASSIC_TAG_PARENT_ID);

  await runLocalWrite(async () =>
    db.transaction(async (tx) => {
      await tx.insert(vfsRegistry).values({
        id: tagId,
        objectType: 'tag',
        ownerId: null,
        organizationId: organizationId ?? null,
        createdAt: now
      });

      await tx.insert(tags).values({
        id: tagId,
        encryptedName: name,
        deleted: false,
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
    })
  );

  await queueItemUpsertAndFlush({
    itemId: tagId,
    objectType: 'tag',
    payload: {
      id: tagId,
      objectType: 'tag',
      name,
      deleted: false
    }
  });

  return tagId;
}

export async function createClassicNote(
  tagId: string | null,
  title: string = DEFAULT_CLASSIC_NOTE_TITLE,
  content: string = '',
  noteId: string = crypto.randomUUID(),
  organizationId?: string | null
): Promise<string> {
  const db = getDatabase();
  const now = new Date();

  await runLocalWrite(async () =>
    db.transaction(async (tx) => {
      await tx.insert(vfsRegistry).values({
        id: noteId,
        objectType: 'note',
        ownerId: null,
        organizationId: organizationId ?? null,
        createdAt: now
      });

      await tx.insert(notes).values({
        id: noteId,
        title,
        content,
        createdAt: now,
        updatedAt: now,
        deleted: false
      });

      // Only link to tag if one is provided (otherwise create untagged note)
      if (tagId) {
        const linkId = crypto.randomUUID();
        const nextPosition = await getNextChildPosition(tagId);
        await tx.insert(vfsLinks).values({
          id: linkId,
          parentId: tagId,
          childId: noteId,
          wrappedSessionKey: '',
          position: nextPosition,
          createdAt: now
        });
      }
    })
  );

  await queueItemUpsertAndFlush({
    itemId: noteId,
    objectType: 'note',
    payload: {
      id: noteId,
      objectType: 'note',
      title,
      content,
      tagId,
      deleted: false
    }
  });

  return noteId;
}

export async function linkNoteToTag(
  tagId: string,
  noteId: string
): Promise<string> {
  const db = getDatabase();

  const existingLink = await db
    .select({ id: vfsLinks.id })
    .from(vfsLinks)
    .where(and(eq(vfsLinks.parentId, tagId), eq(vfsLinks.childId, noteId)))
    .limit(1);

  if (existingLink.length > 0 && existingLink[0]) {
    return existingLink[0].id;
  }

  const linkId = crypto.randomUUID();
  const now = new Date();
  const nextPosition = await getNextChildPosition(tagId);

  await runLocalWrite(async () => {
    await db.insert(vfsLinks).values({
      id: linkId,
      parentId: tagId,
      childId: noteId,
      wrappedSessionKey: '',
      position: nextPosition,
      createdAt: now
    });
  });

  return linkId;
}

export async function deleteClassicTag(tagId: string): Promise<void> {
  const db = getDatabase();

  await runLocalWrite(async () => {
    await db.update(tags).set({ deleted: true }).where(eq(tags.id, tagId));
  });

  await queueItemDeleteAndFlush({
    itemId: tagId,
    objectType: 'tag'
  });
}

export async function restoreClassicTag(tagId: string): Promise<void> {
  const db = getDatabase();

  await runLocalWrite(async () => {
    await db.update(tags).set({ deleted: false }).where(eq(tags.id, tagId));
  });

  const rows = await db
    .select({ encryptedName: tags.encryptedName })
    .from(tags)
    .where(eq(tags.id, tagId))
    .limit(1);
  const restored = rows[0];

  await queueItemUpsertAndFlush({
    itemId: tagId,
    objectType: 'tag',
    payload: {
      id: tagId,
      objectType: 'tag',
      name: restored?.encryptedName ?? DEFAULT_CLASSIC_TAG_NAME,
      deleted: false
    }
  });
}

export async function renameClassicTag(
  tagId: string,
  newName: string
): Promise<void> {
  const db = getDatabase();

  await runLocalWrite(async () => {
    await db
      .update(tags)
      .set({ encryptedName: newName })
      .where(eq(tags.id, tagId));
  });

  await queueItemUpsertAndFlush({
    itemId: tagId,
    objectType: 'tag',
    payload: {
      id: tagId,
      objectType: 'tag',
      name: newName,
      deleted: false
    }
  });
}

export async function updateClassicNote(
  noteId: string,
  title: string,
  content: string
): Promise<void> {
  const db = getDatabase();

  await runLocalWrite(async () => {
    await db
      .update(notes)
      .set({ title, content, updatedAt: new Date() })
      .where(eq(notes.id, noteId));
  });

  await queueItemUpsertAndFlush({
    itemId: noteId,
    objectType: 'note',
    payload: {
      id: noteId,
      objectType: 'note',
      title,
      content,
      deleted: false
    }
  });
}

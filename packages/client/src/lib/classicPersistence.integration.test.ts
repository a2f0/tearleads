import {
  createTestDatabase,
  type TestDatabaseContext
} from '@tearleads/db-test-utils';
import { and, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { migrations } from '@/db/migrations';
import { notes, tags, vfsLinks, vfsRegistry } from '@/db/schema';
import { mockConsoleWarn } from '@/test/console-mocks';

const testDbState = vi.hoisted(() => ({
  db: null as TestDatabaseContext['db'] | null
}));

vi.mock('@/db', () => ({
  getDatabase: () => {
    if (!testDbState.db) {
      throw new Error('Test database has not been initialized');
    }
    return testDbState.db;
  }
}));

import {
  CLASSIC_TAG_PARENT_ID,
  createClassicNote,
  createClassicTag,
  deleteClassicTag,
  linkNoteToTag,
  loadClassicStateFromDatabase,
  persistClassicOrderToDatabase,
  renameClassicTag,
  restoreClassicTag,
  updateClassicNote
} from './classicPersistence';

async function withClassicTestDatabase(
  callback: (context: TestDatabaseContext) => Promise<void>
): Promise<void> {
  const warnSpy = mockConsoleWarn();
  const context = await createTestDatabase({
    migrations,
    instanceId: `classic-${Date.now()}`
  });

  testDbState.db = context.db;

  try {
    await callback(context);
  } finally {
    testDbState.db = null;
    await context.adapter.close();

    const unexpectedWarnings = warnSpy.mock.calls.filter((call) => {
      const message = typeof call[0] === 'string' ? call[0] : '';
      return !message.includes(
        'Ignoring inability to install OPFS sqlite3_vfs'
      );
    });

    expect(unexpectedWarnings).toEqual([]);
    warnSpy.mockRestore();
  }
}

async function seedClassicFixture(
  db: TestDatabaseContext['db']
): Promise<void> {
  const now = new Date();

  await db.insert(vfsRegistry).values({
    id: CLASSIC_TAG_PARENT_ID,
    objectType: 'folder',
    ownerId: null,
    createdAt: now
  });

  await db.insert(vfsRegistry).values([
    { id: 'tag-a', objectType: 'tag', ownerId: null, createdAt: now },
    { id: 'tag-b', objectType: 'tag', ownerId: null, createdAt: now },
    { id: 'note-a1', objectType: 'note', ownerId: null, createdAt: now },
    { id: 'note-a2', objectType: 'note', ownerId: null, createdAt: now },
    { id: 'note-b1', objectType: 'note', ownerId: null, createdAt: now },
    { id: 'note-deleted', objectType: 'note', ownerId: null, createdAt: now }
  ]);

  await db.insert(tags).values([
    { id: 'tag-a', encryptedName: 'Work', color: null, icon: null },
    { id: 'tag-b', encryptedName: 'Ideas', color: null, icon: null }
  ]);

  await db.insert(notes).values([
    {
      id: 'note-a1',
      title: 'A1',
      content: 'alpha',
      createdAt: now,
      updatedAt: now,
      deleted: false
    },
    {
      id: 'note-a2',
      title: 'A2',
      content: 'bravo',
      createdAt: now,
      updatedAt: now,
      deleted: false
    },
    {
      id: 'note-b1',
      title: 'B1',
      content: 'charlie',
      createdAt: now,
      updatedAt: now,
      deleted: false
    },
    {
      id: 'note-deleted',
      title: 'Hidden',
      content: 'deleted',
      createdAt: now,
      updatedAt: now,
      deleted: true
    }
  ]);

  await db.insert(vfsLinks).values([
    {
      id: 'link-root-tag-a',
      parentId: CLASSIC_TAG_PARENT_ID,
      childId: 'tag-a',
      wrappedSessionKey: '',
      position: 1,
      createdAt: now
    },
    {
      id: 'link-root-tag-b',
      parentId: CLASSIC_TAG_PARENT_ID,
      childId: 'tag-b',
      wrappedSessionKey: '',
      position: 0,
      createdAt: now
    },
    {
      id: 'link-tag-a-note-a1',
      parentId: 'tag-a',
      childId: 'note-a1',
      wrappedSessionKey: '',
      position: 1,
      createdAt: now
    },
    {
      id: 'link-tag-a-note-a2',
      parentId: 'tag-a',
      childId: 'note-a2',
      wrappedSessionKey: '',
      position: 0,
      createdAt: now
    },
    {
      id: 'link-tag-a-note-deleted',
      parentId: 'tag-a',
      childId: 'note-deleted',
      wrappedSessionKey: '',
      position: 2,
      createdAt: now
    },
    {
      id: 'link-tag-b-note-b1',
      parentId: 'tag-b',
      childId: 'note-b1',
      wrappedSessionKey: '',
      position: 0,
      createdAt: now
    }
  ]);
}

async function createUntaggedNoteInDb(
  db: TestDatabaseContext['db'],
  note: {
    id: string;
    title: string;
    content: string;
  }
): Promise<void> {
  const now = new Date();
  await db.insert(vfsRegistry).values({
    id: note.id,
    objectType: 'note',
    ownerId: null,
    createdAt: now
  });
  await db.insert(notes).values({
    id: note.id,
    title: note.title,
    content: note.content,
    createdAt: now,
    updatedAt: now,
    deleted: false
  });
}

type UpdatePerfStats = {
  updateCount: number;
  durationMs: number;
};

async function measureUpdatePerf(
  adapter: TestDatabaseContext['adapter'],
  run: () => Promise<void>
): Promise<UpdatePerfStats> {
  const originalExecute = adapter.execute.bind(adapter);
  let updateCount = 0;

  adapter.execute = async (sql, params) => {
    const normalizedSql = sql.trim().toUpperCase();
    if (normalizedSql.startsWith('UPDATE')) {
      updateCount += 1;
    }
    return originalExecute(sql, params);
  };

  const start = performance.now();
  try {
    await run();
  } finally {
    adapter.execute = originalExecute;
  }

  return {
    updateCount,
    durationMs: performance.now() - start
  };
}

async function seedLargeClassicFixture(
  db: TestDatabaseContext['db'],
  options: {
    tagCount: number;
    notesPerTag: number;
  }
): Promise<void> {
  const now = new Date();
  const registryRows: (typeof vfsRegistry.$inferInsert)[] = [
    {
      id: CLASSIC_TAG_PARENT_ID,
      objectType: 'folder',
      ownerId: null,
      createdAt: now
    }
  ];
  const tagRows: (typeof tags.$inferInsert)[] = [];
  const noteRows: (typeof notes.$inferInsert)[] = [];
  const linkRows: (typeof vfsLinks.$inferInsert)[] = [];

  for (let tagIndex = 0; tagIndex < options.tagCount; tagIndex += 1) {
    const tagId = `perf-tag-${tagIndex}`;
    registryRows.push({
      id: tagId,
      objectType: 'tag',
      ownerId: null,
      createdAt: now
    });
    tagRows.push({
      id: tagId,
      encryptedName: `Tag ${tagIndex}`,
      deleted: false,
      color: null,
      icon: null
    });
    linkRows.push({
      id: `perf-link-root-${tagIndex}`,
      parentId: CLASSIC_TAG_PARENT_ID,
      childId: tagId,
      wrappedSessionKey: '',
      position: tagIndex,
      createdAt: now
    });

    for (let noteIndex = 0; noteIndex < options.notesPerTag; noteIndex += 1) {
      const noteId = `perf-note-${tagIndex}-${noteIndex}`;
      registryRows.push({
        id: noteId,
        objectType: 'note',
        ownerId: null,
        createdAt: now
      });
      noteRows.push({
        id: noteId,
        title: `Note ${tagIndex}-${noteIndex}`,
        content: `Body ${tagIndex}-${noteIndex}`,
        createdAt: now,
        updatedAt: now,
        deleted: false
      });
      linkRows.push({
        id: `perf-link-${tagIndex}-${noteIndex}`,
        parentId: tagId,
        childId: noteId,
        wrappedSessionKey: '',
        position: noteIndex,
        createdAt: now
      });
    }
  }

  await db.insert(vfsRegistry).values(registryRows);
  await db.insert(tags).values(tagRows);
  await db.insert(notes).values(noteRows);
  await db.insert(vfsLinks).values(linkRows);
}

describe('classicPersistence integration', () => {
  afterEach(() => {
    testDbState.db = null;
  });

  it('loads classic state from real database rows', async () => {
    await withClassicTestDatabase(async ({ db }) => {
      await seedClassicFixture(db);

      const { state, linkRows } = await loadClassicStateFromDatabase();

      expect(state.tags.map((tag) => tag.id)).toEqual(['tag-b', 'tag-a']);
      expect(state.deletedTags).toEqual([]);
      expect(state.activeTagId).toBe('tag-b');
      expect(state.noteOrderByTagId['tag-a']).toEqual(['note-a2', 'note-a1']);
      expect(state.noteOrderByTagId['tag-b']).toEqual(['note-b1']);
      expect(state.notesById['note-deleted']).toBeUndefined();
      expect(linkRows).toHaveLength(6);
    });
  });

  it('includes untagged notes when tagged notes and tags exist', async () => {
    await withClassicTestDatabase(async ({ db }) => {
      await seedClassicFixture(db);
      await createUntaggedNoteInDb(db, {
        id: 'note-untagged',
        title: 'No Tag',
        content: 'untagged body'
      });

      const { state } = await loadClassicStateFromDatabase();

      expect(state.notesById['note-untagged']).toMatchObject({
        id: 'note-untagged',
        title: 'No Tag'
      });
      expect(state.noteOrderByTagId['tag-a']).not.toContain('note-untagged');
      expect(state.noteOrderByTagId['tag-b']).not.toContain('note-untagged');
    });
  });

  it('persists reordered positions into vfs_links', async () => {
    await withClassicTestDatabase(async ({ db }) => {
      await seedClassicFixture(db);
      const { state, linkRows } = await loadClassicStateFromDatabase();

      const reorderedState = {
        ...state,
        tags: [...state.tags].reverse(),
        noteOrderByTagId: {
          ...state.noteOrderByTagId,
          'tag-a': [...(state.noteOrderByTagId['tag-a'] ?? [])].reverse()
        }
      };

      const updatedRows = await persistClassicOrderToDatabase(
        reorderedState,
        linkRows
      );

      const persistedRootLinks = await db
        .select({
          parentId: vfsLinks.parentId,
          childId: vfsLinks.childId,
          position: vfsLinks.position
        })
        .from(vfsLinks)
        .where(eq(vfsLinks.parentId, CLASSIC_TAG_PARENT_ID));

      const persistedTagALinks = await db
        .select({
          parentId: vfsLinks.parentId,
          childId: vfsLinks.childId,
          position: vfsLinks.position
        })
        .from(vfsLinks)
        .where(
          and(eq(vfsLinks.parentId, 'tag-a'), eq(vfsLinks.childId, 'note-a1'))
        );

      const rootTagAPosition = persistedRootLinks.find(
        (row: { childId: string }) => row.childId === 'tag-a'
      )?.position;
      const rootTagBPosition = persistedRootLinks.find(
        (row: { childId: string }) => row.childId === 'tag-b'
      )?.position;

      expect(rootTagAPosition).toBe(0);
      expect(rootTagBPosition).toBe(1);
      expect(persistedTagALinks[0]?.position).toBe(0);

      const updatedRootTagALink = updatedRows.find(
        (row) =>
          row.parentId === CLASSIC_TAG_PARENT_ID && row.childId === 'tag-a'
      );
      const updatedTagANoteA1Link = updatedRows.find(
        (row) => row.parentId === 'tag-a' && row.childId === 'note-a1'
      );

      expect(updatedRootTagALink?.position).toBe(0);
      expect(updatedTagANoteA1Link?.position).toBe(0);
    });
  });

  it('reorders large datasets with a single update query', async () => {
    await withClassicTestDatabase(async ({ db, adapter }) => {
      await seedLargeClassicFixture(db, {
        tagCount: 24,
        notesPerTag: 12
      });

      const { state, linkRows } = await loadClassicStateFromDatabase();
      const reversedNoteOrderByTagId: typeof state.noteOrderByTagId = {};
      for (const [tagId, noteIds] of Object.entries(state.noteOrderByTagId)) {
        reversedNoteOrderByTagId[tagId] = [...noteIds].reverse();
      }
      const reorderedState = {
        ...state,
        tags: [...state.tags].reverse(),
        noteOrderByTagId: reversedNoteOrderByTagId
      };

      const perf = await measureUpdatePerf(adapter, async () => {
        await persistClassicOrderToDatabase(reorderedState, linkRows);
      });

      expect(perf.durationMs).toBeLessThanOrEqual(1_000);
      expect(perf.updateCount).toBeLessThanOrEqual(1);
    });
  });

  it('soft-deletes tag and preserves links across reloads', async () => {
    await withClassicTestDatabase(async ({ db }) => {
      await seedClassicFixture(db);

      await deleteClassicTag('tag-a');

      const { state: reloadedState } = await loadClassicStateFromDatabase();

      expect(reloadedState.tags.map((tag) => tag.id)).not.toContain('tag-a');
      expect(reloadedState.deletedTags.map((tag) => tag.id)).toContain('tag-a');
      expect(reloadedState.notesById['note-a1']).toBeDefined();
      expect(reloadedState.notesById['note-a2']).toBeDefined();
      expect(reloadedState.noteOrderByTagId['tag-a']).toBeUndefined();

      const orphanedTagLinks = await db
        .select({ childId: vfsLinks.childId })
        .from(vfsLinks)
        .where(eq(vfsLinks.childId, 'tag-a'));
      const tagANoteLinks = await db
        .select({ parentId: vfsLinks.parentId })
        .from(vfsLinks)
        .where(eq(vfsLinks.parentId, 'tag-a'));

      expect(orphanedTagLinks).toHaveLength(1);
      expect(tagANoteLinks).toHaveLength(3);
    });
  });

  it('restores a soft-deleted tag across reloads', async () => {
    await withClassicTestDatabase(async ({ db }) => {
      await seedClassicFixture(db);

      await deleteClassicTag('tag-a');
      await restoreClassicTag('tag-a');

      const { state: reloadedState } = await loadClassicStateFromDatabase();

      expect(reloadedState.tags.map((tag) => tag.id)).toContain('tag-a');
      expect(reloadedState.deletedTags.map((tag) => tag.id)).not.toContain(
        'tag-a'
      );

      const restoredTagRows = await db
        .select({ deleted: tags.deleted })
        .from(tags)
        .where(eq(tags.id, 'tag-a'));

      expect(restoredTagRows[0]?.deleted).toBe(false);
    });
  });

  it('returns empty state when no classic data exists', async () => {
    await withClassicTestDatabase(async () => {
      const { state, linkRows } = await loadClassicStateFromDatabase();

      expect(state.tags).toEqual([]);
      expect(state.deletedTags).toEqual([]);
      expect(state.notesById).toEqual({});
      expect(state.noteOrderByTagId).toEqual({});
      expect(state.activeTagId).toBeNull();
      expect(linkRows).toEqual([]);
    });
  });

  it('does not mutate links when ordering is unchanged', async () => {
    await withClassicTestDatabase(async ({ db }) => {
      await seedClassicFixture(db);
      const { state, linkRows } = await loadClassicStateFromDatabase();

      const updatedRows = await persistClassicOrderToDatabase(state, linkRows);

      expect(updatedRows).toEqual(linkRows);

      const rootLinks = await db
        .select({
          childId: vfsLinks.childId,
          position: vfsLinks.position
        })
        .from(vfsLinks)
        .where(eq(vfsLinks.parentId, CLASSIC_TAG_PARENT_ID));

      const rootTagAPosition = rootLinks.find(
        (row: { childId: string }) => row.childId === 'tag-a'
      )?.position;
      const rootTagBPosition = rootLinks.find(
        (row: { childId: string }) => row.childId === 'tag-b'
      )?.position;

      expect(rootTagAPosition).toBe(1);
      expect(rootTagBPosition).toBe(0);
    });
  });

  it('creates a classic tag and links it under root with next position', async () => {
    await withClassicTestDatabase(async ({ db }) => {
      await seedClassicFixture(db);

      const createdTagId = await createClassicTag('Inbox');

      const createdTagRows = await db
        .select({
          name: tags.encryptedName
        })
        .from(tags)
        .where(eq(tags.id, createdTagId));

      const createdLinkRows = await db
        .select({
          parentId: vfsLinks.parentId,
          childId: vfsLinks.childId,
          position: vfsLinks.position
        })
        .from(vfsLinks)
        .where(eq(vfsLinks.childId, createdTagId));

      expect(createdTagRows[0]?.name).toBe('Inbox');
      expect(createdLinkRows[0]?.parentId).toBe(CLASSIC_TAG_PARENT_ID);
      expect(createdLinkRows[0]?.position).toBe(2);
    });
  });

  it('creates a classic note and links it under the selected tag', async () => {
    await withClassicTestDatabase(async ({ db }) => {
      await seedClassicFixture(db);

      const createdNoteId = await createClassicNote('tag-a', 'Quick note');

      const createdNoteRows = await db
        .select({
          title: notes.title,
          content: notes.content,
          deleted: notes.deleted
        })
        .from(notes)
        .where(eq(notes.id, createdNoteId));

      const createdLinkRows = await db
        .select({
          parentId: vfsLinks.parentId,
          childId: vfsLinks.childId,
          position: vfsLinks.position
        })
        .from(vfsLinks)
        .where(eq(vfsLinks.childId, createdNoteId));

      expect(createdNoteRows[0]?.title).toBe('Quick note');
      expect(createdNoteRows[0]?.content).toBe('');
      expect(createdNoteRows[0]?.deleted).toBe(false);
      expect(createdLinkRows[0]?.parentId).toBe('tag-a');
      expect(createdLinkRows[0]?.position).toBe(3);
    });
  });

  it('links an existing note to a different tag via drag-drop', async () => {
    await withClassicTestDatabase(async ({ db }) => {
      await seedClassicFixture(db);

      await linkNoteToTag('tag-b', 'note-a1');

      const { state } = await loadClassicStateFromDatabase();

      expect(state.noteOrderByTagId['tag-a']).toContain('note-a1');
      expect(state.noteOrderByTagId['tag-b']).toContain('note-a1');

      const linkRows = await db
        .select({
          parentId: vfsLinks.parentId,
          childId: vfsLinks.childId,
          position: vfsLinks.position
        })
        .from(vfsLinks)
        .where(eq(vfsLinks.childId, 'note-a1'));

      expect(linkRows).toHaveLength(2);
      expect(
        linkRows.map((r: { parentId: string }) => r.parentId).sort()
      ).toEqual(['tag-a', 'tag-b']);
    });
  });

  it('returns existing link id when note is already linked to tag', async () => {
    await withClassicTestDatabase(async ({ db }) => {
      await seedClassicFixture(db);

      const firstLinkId = await linkNoteToTag('tag-a', 'note-a1');

      const existingLinkRows = await db
        .select({ id: vfsLinks.id })
        .from(vfsLinks)
        .where(
          and(eq(vfsLinks.parentId, 'tag-a'), eq(vfsLinks.childId, 'note-a1'))
        );

      expect(firstLinkId).toBe(existingLinkRows[0]?.id);

      const allTagALinks = await db
        .select({ childId: vfsLinks.childId })
        .from(vfsLinks)
        .where(eq(vfsLinks.parentId, 'tag-a'));

      const noteA1Links = allTagALinks.filter(
        (r: { childId: string }) => r.childId === 'note-a1'
      );
      expect(noteA1Links).toHaveLength(1);
    });
  });

  it('appends note at correct position when linking to tag', async () => {
    await withClassicTestDatabase(async ({ db }) => {
      await seedClassicFixture(db);

      await linkNoteToTag('tag-b', 'note-a2');

      const linkRows = await db
        .select({
          childId: vfsLinks.childId,
          position: vfsLinks.position
        })
        .from(vfsLinks)
        .where(eq(vfsLinks.parentId, 'tag-b'));

      const noteA2Link = linkRows.find(
        (r: { childId: string }) => r.childId === 'note-a2'
      );
      expect(noteA2Link?.position).toBe(1);
    });
  });

  it('creates an untagged note when tagId is null', async () => {
    await withClassicTestDatabase(async ({ db }) => {
      await seedClassicFixture(db);

      const createdNoteId = await createClassicNote(null, 'Untagged note');

      // Verify the note was created
      const createdNoteRows = await db
        .select({
          title: notes.title,
          content: notes.content,
          deleted: notes.deleted
        })
        .from(notes)
        .where(eq(notes.id, createdNoteId));

      expect(createdNoteRows[0]?.title).toBe('Untagged note');
      expect(createdNoteRows[0]?.content).toBe('');
      expect(createdNoteRows[0]?.deleted).toBe(false);

      // Verify vfs registry entry was created
      const registryRows = await db
        .select({ objectType: vfsRegistry.objectType })
        .from(vfsRegistry)
        .where(eq(vfsRegistry.id, createdNoteId));

      expect(registryRows[0]?.objectType).toBe('note');

      // Verify NO link was created (note is untagged)
      const linkRows = await db
        .select({ parentId: vfsLinks.parentId })
        .from(vfsLinks)
        .where(eq(vfsLinks.childId, createdNoteId));

      expect(linkRows).toHaveLength(0);

      // Verify the note appears in untagged notes when reloading state
      const { state } = await loadClassicStateFromDatabase();

      expect(state.notesById[createdNoteId]).toMatchObject({
        id: createdNoteId,
        title: 'Untagged note'
      });

      // Note should not be in any tag's order
      for (const noteOrder of Object.values(state.noteOrderByTagId)) {
        expect(noteOrder).not.toContain(createdNoteId);
      }
    });
  });

  it('renames a tag and persists the change across reloads', async () => {
    await withClassicTestDatabase(async ({ db }) => {
      await seedClassicFixture(db);

      // Verify initial name
      const { state: initialState } = await loadClassicStateFromDatabase();
      const tagA = initialState.tags.find((t) => t.id === 'tag-a');
      expect(tagA?.name).toBe('Work');

      // Rename the tag
      await renameClassicTag('tag-a', 'Projects');

      // Reload and verify persisted
      const { state: reloadedState } = await loadClassicStateFromDatabase();
      const renamedTag = reloadedState.tags.find((t) => t.id === 'tag-a');
      expect(renamedTag?.name).toBe('Projects');

      // Verify directly in database
      const dbTagRows = await db
        .select({ name: tags.encryptedName })
        .from(tags)
        .where(eq(tags.id, 'tag-a'));
      expect(dbTagRows[0]?.name).toBe('Projects');
    });
  });

  it('updates note title and body and persists the change across reloads', async () => {
    await withClassicTestDatabase(async ({ db }) => {
      await seedClassicFixture(db);

      // Verify initial content
      const { state: initialState } = await loadClassicStateFromDatabase();
      expect(initialState.notesById['note-a1']?.title).toBe('A1');
      expect(initialState.notesById['note-a1']?.body).toBe('alpha');

      // Update the note
      await updateClassicNote(
        'note-a1',
        'Updated Title',
        'Updated body content'
      );

      // Reload and verify persisted
      const { state: reloadedState } = await loadClassicStateFromDatabase();
      expect(reloadedState.notesById['note-a1']?.title).toBe('Updated Title');
      expect(reloadedState.notesById['note-a1']?.body).toBe(
        'Updated body content'
      );

      // Verify directly in database
      const dbNoteRows = await db
        .select({ title: notes.title, content: notes.content })
        .from(notes)
        .where(eq(notes.id, 'note-a1'));
      expect(dbNoteRows[0]?.title).toBe('Updated Title');
      expect(dbNoteRows[0]?.content).toBe('Updated body content');
    });
  });

  it('creates a tag with pre-generated ID and persists across reloads', async () => {
    await withClassicTestDatabase(async ({ db }) => {
      await seedClassicFixture(db);

      // Simulate the flow: ClassicApp generates ID, then calls onCreateTag
      const preGeneratedId = 'pre-gen-tag-id';
      await createClassicTag('My New Tag', preGeneratedId);

      // Reload and verify persisted
      const { state: reloadedState } = await loadClassicStateFromDatabase();
      const newTag = reloadedState.tags.find((t) => t.id === preGeneratedId);
      expect(newTag).toBeDefined();
      expect(newTag?.name).toBe('My New Tag');

      // Verify directly in database
      const dbTagRows = await db
        .select({ name: tags.encryptedName })
        .from(tags)
        .where(eq(tags.id, preGeneratedId));
      expect(dbTagRows[0]?.name).toBe('My New Tag');
    });
  });

  it('creates a note with pre-generated ID, title, and body and persists across reloads', async () => {
    await withClassicTestDatabase(async ({ db }) => {
      await seedClassicFixture(db);

      // Simulate the flow: ClassicApp generates ID, then calls onCreateNote
      const preGeneratedId = 'pre-gen-note-id';
      await createClassicNote(
        'tag-a',
        'My New Note',
        'Note body here',
        preGeneratedId
      );

      // Reload and verify persisted
      const { state: reloadedState } = await loadClassicStateFromDatabase();
      expect(reloadedState.notesById[preGeneratedId]).toBeDefined();
      expect(reloadedState.notesById[preGeneratedId]?.title).toBe(
        'My New Note'
      );
      expect(reloadedState.notesById[preGeneratedId]?.body).toBe(
        'Note body here'
      );
      expect(reloadedState.noteOrderByTagId['tag-a']).toContain(preGeneratedId);

      // Verify directly in database
      const dbNoteRows = await db
        .select({ title: notes.title, content: notes.content })
        .from(notes)
        .where(eq(notes.id, preGeneratedId));
      expect(dbNoteRows[0]?.title).toBe('My New Note');
      expect(dbNoteRows[0]?.content).toBe('Note body here');
    });
  });
});

import {
  createTestDatabase,
  type TestDatabaseContext
} from '@tearleads/db-test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { migrations } from '@/db/migrations';
import { notes, tags, vfsLinks, vfsRegistry } from '@/db/schema';
import { mockConsoleWarn } from '@/test/consoleMocks';

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
  deleteClassicTag,
  loadClassicStateFromDatabase,
  persistClassicOrderToDatabase,
  restoreClassicTag
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

async function _createUntaggedNoteInDb(
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

  it('reorders large datasets with a single update query', async () => {
    await withClassicTestDatabase(async ({ db, adapter }) => {
      await seedLargeClassicFixture(db, {
        tagCount: 24,
        notesPerTag: 12
      });

      const { state, linkRows } = await loadClassicStateFromDatabase();
      const reversedNoteOrderByTagId: typeof state.noteOrderByTagId =
        Object.fromEntries(
          Object.entries(state.noteOrderByTagId).map(([tagId, noteIds]) => [
            tagId,
            [...noteIds].reverse()
          ])
        );
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
});

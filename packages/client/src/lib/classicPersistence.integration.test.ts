import {
  createTestDatabase,
  type TestDatabaseContext
} from '@rapid/db-test-utils';
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
  loadClassicStateFromDatabase,
  persistClassicOrderToDatabase
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

describe('classicPersistence integration', () => {
  afterEach(() => {
    testDbState.db = null;
  });

  it('loads classic state from real database rows', async () => {
    await withClassicTestDatabase(async ({ db }) => {
      await seedClassicFixture(db);

      const { state, linkRows } = await loadClassicStateFromDatabase();

      expect(state.tags.map((tag) => tag.id)).toEqual(['tag-b', 'tag-a']);
      expect(state.activeTagId).toBe('tag-b');
      expect(state.noteOrderByTagId['tag-a']).toEqual(['note-a2', 'note-a1']);
      expect(state.noteOrderByTagId['tag-b']).toEqual(['note-b1']);
      expect(state.notesById['note-deleted']).toBeUndefined();
      expect(linkRows).toHaveLength(6);
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
        (row) => row.childId === 'tag-a'
      )?.position;
      const rootTagBPosition = persistedRootLinks.find(
        (row) => row.childId === 'tag-b'
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

  it('returns empty state when no classic data exists', async () => {
    await withClassicTestDatabase(async () => {
      const { state, linkRows } = await loadClassicStateFromDatabase();

      expect(state.tags).toEqual([]);
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
        (row) => row.childId === 'tag-a'
      )?.position;
      const rootTagBPosition = rootLinks.find(
        (row) => row.childId === 'tag-b'
      )?.position;

      expect(rootTagAPosition).toBe(1);
      expect(rootTagBPosition).toBe(0);
    });
  });
});

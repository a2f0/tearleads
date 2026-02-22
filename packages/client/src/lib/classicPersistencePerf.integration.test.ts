import {
  createTestDatabase,
  type TestDatabaseContext
} from '@tearleads/db-test-utils';
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

describe('classicPersistence perf integration', () => {
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
});

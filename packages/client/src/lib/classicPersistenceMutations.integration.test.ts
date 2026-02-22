import {
  createTestDatabase,
  type TestDatabaseContext
} from '@tearleads/db-test-utils';
import { and, eq } from 'drizzle-orm';
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
  createClassicNote,
  createClassicTag,
  linkNoteToTag,
  loadClassicStateFromDatabase,
  renameClassicTag,
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

describe('classicPersistence mutations integration', () => {
  afterEach(() => {
    testDbState.db = null;
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

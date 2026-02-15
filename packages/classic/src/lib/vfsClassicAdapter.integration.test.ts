import { notes, tags, vfsLinks, vfsRegistry } from '@tearleads/db/sqlite';
import {
  classicTestMigrations,
  withRealDatabase
} from '@tearleads/db-test-utils';
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sortNoteIds, sortTags } from './sorting';
import type {
  VfsLinkLikeRow,
  VfsNoteLikeRow,
  VfsRegistryLikeRow,
  VfsTagLikeRow
} from './types';
import { buildClassicStateFromVfs } from './vfsClassicAdapter';
import { buildClassicPositionUpdates } from './vfsPositionUpdates';

// Classic uses a dedicated folder as the parent for all tags
const CLASSIC_ROOT_ID = '11111111-1111-1111-1111-111111111111';

describe('Classic VFS Integration (real database)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('builds state from empty database', async () => {
    await withRealDatabase(
      async ({ db }) => {
        const now = new Date();

        // Create classic root folder
        await db.insert(vfsRegistry).values({
          id: CLASSIC_ROOT_ID,
          objectType: 'folder',
          ownerId: null,
          encryptedName: 'Classic',
          createdAt: now
        });

        const data = await queryClassicData(db);
        const state = buildClassicStateFromVfs({
          rootTagParentId: CLASSIC_ROOT_ID,
          ...data
        });

        expect(state.tags).toHaveLength(0);
        expect(state.deletedTags).toHaveLength(0);
        expect(state.notesById).toEqual({});
        expect(state.noteOrderByTagId).toEqual({});
        expect(state.activeTagId).toBeNull();
      },
      { migrations: classicTestMigrations }
    );
  });

  it('builds state with tags in correct order', async () => {
    await withRealDatabase(
      async ({ db }) => {
        const now = new Date();
        await seedClassicRoot(db, now);

        await seedTag(db, { id: 'tag-1', name: 'Work', position: 0, now });
        await seedTag(db, { id: 'tag-2', name: 'Personal', position: 1, now });
        await seedTag(db, { id: 'tag-3', name: 'Projects', position: 2, now });

        const data = await queryClassicData(db);
        const state = buildClassicStateFromVfs({
          rootTagParentId: CLASSIC_ROOT_ID,
          ...data
        });

        expect(state.tags).toHaveLength(3);
        expect(state.tags.map((t) => t.name)).toEqual([
          'Work',
          'Personal',
          'Projects'
        ]);
        expect(state.activeTagId).toBe('tag-1');
      },
      { migrations: classicTestMigrations }
    );
  });

  it('separates deleted tags from active tags', async () => {
    await withRealDatabase(
      async ({ db }) => {
        const now = new Date();
        await seedClassicRoot(db, now);

        await seedTag(db, {
          id: 'tag-1',
          name: 'Active Tag',
          position: 0,
          now
        });
        await seedTag(db, {
          id: 'tag-2',
          name: 'Deleted Tag',
          deleted: true,
          position: 1,
          now
        });

        const data = await queryClassicData(db);
        const state = buildClassicStateFromVfs({
          rootTagParentId: CLASSIC_ROOT_ID,
          ...data
        });

        expect(state.tags).toHaveLength(1);
        expect(state.tags[0]?.name).toBe('Active Tag');
        expect(state.deletedTags).toHaveLength(1);
        expect(state.deletedTags[0]?.name).toBe('Deleted Tag');
      },
      { migrations: classicTestMigrations }
    );
  });

  it('builds state with notes linked to tags', async () => {
    await withRealDatabase(
      async ({ db }) => {
        const now = new Date();
        await seedClassicRoot(db, now);
        await seedTag(db, { id: 'tag-1', name: 'Work', position: 0, now });

        await seedNote(db, {
          id: 'note-1',
          title: 'First Note',
          content: 'Content 1',
          tagId: 'tag-1',
          position: 0,
          now
        });
        await seedNote(db, {
          id: 'note-2',
          title: 'Second Note',
          content: 'Content 2',
          tagId: 'tag-1',
          position: 1,
          now
        });

        const data = await queryClassicData(db);
        const state = buildClassicStateFromVfs({
          rootTagParentId: CLASSIC_ROOT_ID,
          ...data
        });

        expect(Object.keys(state.notesById)).toHaveLength(2);
        expect(state.notesById['note-1']).toEqual({
          id: 'note-1',
          title: 'First Note',
          body: 'Content 1'
        });
        expect(state.noteOrderByTagId['tag-1']).toEqual(['note-1', 'note-2']);
      },
      { migrations: classicTestMigrations }
    );
  });

  it('hydrates metadata for menu-bar date and count sorting', async () => {
    await withRealDatabase(
      async ({ db }) => {
        await seedClassicRoot(db, new Date('2024-01-01T00:00:00.000Z'));

        await seedTag(db, {
          id: 'tag-1',
          name: 'Alpha',
          position: 0,
          now: new Date('2024-01-02T00:00:00.000Z')
        });
        await seedTag(db, {
          id: 'tag-2',
          name: 'Beta',
          position: 1,
          now: new Date('2024-01-03T00:00:00.000Z')
        });

        await seedNote(db, {
          id: 'note-1',
          title: 'Zulu',
          content: 'ccc',
          tagId: 'tag-1',
          position: 0,
          now: new Date('2024-01-04T00:00:00.000Z')
        });
        await seedNote(db, {
          id: 'note-2',
          title: 'Alpha',
          content: 'aaa',
          tagId: 'tag-1',
          position: 1,
          now: new Date('2024-01-05T00:00:00.000Z')
        });

        await db
          .update(vfsLinks)
          .set({ createdAt: new Date('2024-01-06T00:00:00.000Z') })
          .where(
            and(eq(vfsLinks.parentId, 'tag-1'), eq(vfsLinks.childId, 'note-1'))
          );

        await db
          .update(vfsLinks)
          .set({ createdAt: new Date('2024-01-07T00:00:00.000Z') })
          .where(
            and(eq(vfsLinks.parentId, 'tag-1'), eq(vfsLinks.childId, 'note-2'))
          );

        await db
          .update(notes)
          .set({ updatedAt: new Date('2024-01-10T00:00:00.000Z') })
          .where(eq(notes.id, 'note-1'));

        await db
          .update(notes)
          .set({ updatedAt: new Date('2024-01-09T00:00:00.000Z') })
          .where(eq(notes.id, 'note-2'));

        await db.insert(vfsLinks).values({
          id: crypto.randomUUID(),
          parentId: 'tag-2',
          childId: 'note-2',
          wrappedSessionKey: 'test-key',
          position: 0,
          createdAt: new Date('2024-01-11T00:00:00.000Z')
        });

        const data = await queryClassicData(db);
        const state = buildClassicStateFromVfs({
          rootTagParentId: CLASSIC_ROOT_ID,
          ...data
        });

        expect(
          sortTags({
            state,
            tags: state.tags,
            sortOrder: 'date-created-desc'
          }).map((tag) => tag.id)
        ).toEqual(['tag-2', 'tag-1']);

        expect(
          sortTags({
            state,
            tags: state.tags,
            sortOrder: 'entry-count-desc'
          }).map((tag) => tag.id)
        ).toEqual(['tag-1', 'tag-2']);

        expect(
          sortTags({
            state,
            tags: state.tags,
            sortOrder: 'date-last-used-desc'
          }).map((tag) => tag.id)
        ).toEqual(['tag-2', 'tag-1']);

        const tag1NoteIds = state.noteOrderByTagId['tag-1'];
        if (!tag1NoteIds) {
          throw new Error('Expected notes for tag-1');
        }

        expect(
          sortNoteIds({
            state,
            noteIds: tag1NoteIds,
            activeTagId: 'tag-1',
            sortOrder: 'date-tagged-desc'
          })
        ).toEqual(['note-2', 'note-1']);

        expect(
          sortNoteIds({
            state,
            noteIds: tag1NoteIds,
            activeTagId: 'tag-1',
            sortOrder: 'subject-asc'
          })
        ).toEqual(['note-2', 'note-1']);

        const allNoteIds = Object.keys(state.notesById);
        expect(
          sortNoteIds({
            state,
            noteIds: allNoteIds,
            activeTagId: null,
            sortOrder: 'date-updated-desc'
          })
        ).toEqual(['note-1', 'note-2']);

        expect(
          sortNoteIds({
            state,
            noteIds: allNoteIds,
            activeTagId: null,
            sortOrder: 'tag-count-desc'
          })
        ).toEqual(['note-2', 'note-1']);
      },
      { migrations: classicTestMigrations }
    );
  });

  it('persists position updates back to database', async () => {
    await withRealDatabase(
      async ({ db }) => {
        const now = new Date();
        await seedClassicRoot(db, now);
        await seedTag(db, { id: 'tag-1', name: 'Work', position: 0, now });
        await seedTag(db, { id: 'tag-2', name: 'Personal', position: 1, now });

        // Load initial state
        const initialData = await queryClassicData(db);
        const initialState = buildClassicStateFromVfs({
          rootTagParentId: CLASSIC_ROOT_ID,
          ...initialData
        });

        expect(initialState.tags.map((t) => t.id)).toEqual(['tag-1', 'tag-2']);

        // Simulate reordering: swap tag order
        const tag0 = initialState.tags[0];
        const tag1 = initialState.tags[1];
        if (!tag0 || !tag1) {
          throw new Error('Expected two tags');
        }
        const reorderedState = {
          ...initialState,
          tags: [tag1, tag0]
        };

        // Compute position updates
        const updates = buildClassicPositionUpdates(
          reorderedState,
          CLASSIC_ROOT_ID,
          initialData.linkRows
        );

        // Apply updates to database
        for (const update of updates) {
          await db
            .update(vfsLinks)
            .set({ position: update.position })
            .where(eq(vfsLinks.childId, update.childId));
        }

        // Reload state and verify order persisted
        const reloadedData = await queryClassicData(db);
        const reloadedState = buildClassicStateFromVfs({
          rootTagParentId: CLASSIC_ROOT_ID,
          ...reloadedData
        });

        expect(reloadedState.tags.map((t) => t.id)).toEqual(['tag-2', 'tag-1']);
      },
      { migrations: classicTestMigrations }
    );
  });

  it('persists note reordering within a tag', async () => {
    await withRealDatabase(
      async ({ db }) => {
        const now = new Date();
        await seedClassicRoot(db, now);
        await seedTag(db, { id: 'tag-1', name: 'Work', position: 0, now });

        await seedNote(db, {
          id: 'note-1',
          title: 'First',
          tagId: 'tag-1',
          position: 0,
          now
        });
        await seedNote(db, {
          id: 'note-2',
          title: 'Second',
          tagId: 'tag-1',
          position: 1,
          now
        });
        await seedNote(db, {
          id: 'note-3',
          title: 'Third',
          tagId: 'tag-1',
          position: 2,
          now
        });

        // Load initial state
        const initialData = await queryClassicData(db);
        const initialState = buildClassicStateFromVfs({
          rootTagParentId: CLASSIC_ROOT_ID,
          ...initialData
        });

        expect(initialState.noteOrderByTagId['tag-1']).toEqual([
          'note-1',
          'note-2',
          'note-3'
        ]);

        // Simulate reordering: move note-3 to the top
        const reorderedState = {
          ...initialState,
          noteOrderByTagId: {
            'tag-1': ['note-3', 'note-1', 'note-2']
          }
        };

        // Compute and apply position updates
        const updates = buildClassicPositionUpdates(
          reorderedState,
          CLASSIC_ROOT_ID,
          initialData.linkRows
        );

        for (const update of updates) {
          await db
            .update(vfsLinks)
            .set({ position: update.position })
            .where(eq(vfsLinks.childId, update.childId));
        }

        // Reload and verify
        const reloadedData = await queryClassicData(db);
        const reloadedState = buildClassicStateFromVfs({
          rootTagParentId: CLASSIC_ROOT_ID,
          ...reloadedData
        });

        expect(reloadedState.noteOrderByTagId['tag-1']).toEqual([
          'note-3',
          'note-1',
          'note-2'
        ]);
      },
      { migrations: classicTestMigrations }
    );
  });

  it('handles tag rename persistence', async () => {
    await withRealDatabase(
      async ({ db }) => {
        const now = new Date();
        await seedClassicRoot(db, now);
        await seedTag(db, {
          id: 'tag-1',
          name: 'Original Name',
          position: 0,
          now
        });

        // Verify initial name
        const initialData = await queryClassicData(db);
        const initialState = buildClassicStateFromVfs({
          rootTagParentId: CLASSIC_ROOT_ID,
          ...initialData
        });
        expect(initialState.tags[0]?.name).toBe('Original Name');

        // Rename tag
        await db
          .update(tags)
          .set({ encryptedName: 'Renamed Tag' })
          .where(eq(tags.id, 'tag-1'));

        // Reload and verify
        const reloadedData = await queryClassicData(db);
        const reloadedState = buildClassicStateFromVfs({
          rootTagParentId: CLASSIC_ROOT_ID,
          ...reloadedData
        });

        expect(reloadedState.tags[0]?.name).toBe('Renamed Tag');
      },
      { migrations: classicTestMigrations }
    );
  });

  it('handles soft delete and restore of tags', async () => {
    await withRealDatabase(
      async ({ db }) => {
        const now = new Date();
        await seedClassicRoot(db, now);
        await seedTag(db, { id: 'tag-1', name: 'My Tag', position: 0, now });

        // Verify tag is active initially
        let data = await queryClassicData(db);
        let state = buildClassicStateFromVfs({
          rootTagParentId: CLASSIC_ROOT_ID,
          ...data
        });
        expect(state.tags).toHaveLength(1);
        expect(state.deletedTags).toHaveLength(0);

        // Soft delete the tag
        await db
          .update(tags)
          .set({ deleted: true })
          .where(eq(tags.id, 'tag-1'));

        // Verify tag moved to deleted
        data = await queryClassicData(db);
        state = buildClassicStateFromVfs({
          rootTagParentId: CLASSIC_ROOT_ID,
          ...data
        });
        expect(state.tags).toHaveLength(0);
        expect(state.deletedTags).toHaveLength(1);
        expect(state.deletedTags[0]?.name).toBe('My Tag');

        // Restore the tag
        await db
          .update(tags)
          .set({ deleted: false })
          .where(eq(tags.id, 'tag-1'));

        // Verify tag is active again
        data = await queryClassicData(db);
        state = buildClassicStateFromVfs({
          rootTagParentId: CLASSIC_ROOT_ID,
          ...data
        });
        expect(state.tags).toHaveLength(1);
        expect(state.deletedTags).toHaveLength(0);
      },
      { migrations: classicTestMigrations }
    );
  });

  it('handles note content update persistence', async () => {
    await withRealDatabase(
      async ({ db }) => {
        const now = new Date();
        await seedClassicRoot(db, now);
        await seedTag(db, { id: 'tag-1', name: 'Work', position: 0, now });
        await seedNote(db, {
          id: 'note-1',
          title: 'Original Title',
          content: 'Original content',
          tagId: 'tag-1',
          position: 0,
          now
        });

        // Verify initial content
        let data = await queryClassicData(db);
        let state = buildClassicStateFromVfs({
          rootTagParentId: CLASSIC_ROOT_ID,
          ...data
        });
        expect(state.notesById['note-1']?.title).toBe('Original Title');
        expect(state.notesById['note-1']?.body).toBe('Original content');

        // Update note
        await db
          .update(notes)
          .set({ title: 'Updated Title', content: 'Updated content' })
          .where(eq(notes.id, 'note-1'));

        // Reload and verify
        data = await queryClassicData(db);
        state = buildClassicStateFromVfs({
          rootTagParentId: CLASSIC_ROOT_ID,
          ...data
        });
        expect(state.notesById['note-1']?.title).toBe('Updated Title');
        expect(state.notesById['note-1']?.body).toBe('Updated content');
      },
      { migrations: classicTestMigrations }
    );
  });
});

// Helper types
type TestDb = Parameters<Parameters<typeof withRealDatabase>[0]>[0]['db'];

// Helper functions using Drizzle ORM
async function seedClassicRoot(db: TestDb, now: Date): Promise<void> {
  await db.insert(vfsRegistry).values({
    id: CLASSIC_ROOT_ID,
    objectType: 'folder',
    ownerId: null,
    encryptedName: 'Classic',
    createdAt: now
  });
}

async function seedTag(
  db: TestDb,
  options: {
    id: string;
    name: string;
    deleted?: boolean;
    position?: number;
    now: Date;
  }
): Promise<string> {
  const { id, name, deleted = false, position, now } = options;

  await db.insert(vfsRegistry).values({
    id,
    objectType: 'tag',
    ownerId: null,
    createdAt: now
  });

  await db.insert(tags).values({
    id,
    encryptedName: name,
    deleted
  });

  const linkId = crypto.randomUUID();
  await db.insert(vfsLinks).values({
    id: linkId,
    parentId: CLASSIC_ROOT_ID,
    childId: id,
    wrappedSessionKey: 'test-key',
    position: position ?? null,
    createdAt: now
  });

  return id;
}

async function seedNote(
  db: TestDb,
  options: {
    id: string;
    title: string;
    content?: string;
    tagId: string;
    position?: number;
    now: Date;
  }
): Promise<string> {
  const { id, title, content = '', tagId, position, now } = options;

  await db.insert(vfsRegistry).values({
    id,
    objectType: 'note',
    ownerId: null,
    createdAt: now
  });

  await db.insert(notes).values({
    id,
    title,
    content,
    createdAt: now,
    updatedAt: now
  });

  const linkId = crypto.randomUUID();
  await db.insert(vfsLinks).values({
    id: linkId,
    parentId: tagId,
    childId: id,
    wrappedSessionKey: 'test-key',
    position: position ?? null,
    createdAt: now
  });

  return id;
}

async function queryClassicData(db: TestDb): Promise<{
  registryRows: VfsRegistryLikeRow[];
  tagRows: VfsTagLikeRow[];
  noteRows: VfsNoteLikeRow[];
  linkRows: VfsLinkLikeRow[];
}> {
  const registryRows = await db
    .select({
      id: vfsRegistry.id,
      objectType: vfsRegistry.objectType,
      createdAt: vfsRegistry.createdAt
    })
    .from(vfsRegistry);

  const tagRows = await db
    .select({
      id: tags.id,
      encryptedName: tags.encryptedName,
      deleted: tags.deleted
    })
    .from(tags);

  const noteRows = await db
    .select({
      id: notes.id,
      title: notes.title,
      content: notes.content,
      createdAt: notes.createdAt,
      updatedAt: notes.updatedAt
    })
    .from(notes);

  const linkRows = await db
    .select({
      parentId: vfsLinks.parentId,
      childId: vfsLinks.childId,
      position: vfsLinks.position,
      createdAt: vfsLinks.createdAt
    })
    .from(vfsLinks);

  return {
    registryRows,
    tagRows,
    noteRows,
    linkRows
  };
}

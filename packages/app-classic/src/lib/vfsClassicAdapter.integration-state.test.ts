import { notes, vfsLinks } from '@tearleads/db/sqlite';
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CLASSIC_ROOT_ID,
  queryClassicData,
  seedClassicRoot,
  seedNote,
  seedTag,
  withClassicRealDatabase
} from '../test/vfsClassicAdapter.integration-test-support';
import { sortNoteIds, sortTags } from './sorting';
import { buildClassicStateFromVfs } from './vfsClassicAdapter';

describe('Classic VFS Integration state hydration (real database)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('builds state from empty database', async () => {
    await withClassicRealDatabase(async ({ db }) => {
      const now = new Date();
      await seedClassicRoot(db, now);

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
    });
  });

  it('builds state with tags in correct order', async () => {
    await withClassicRealDatabase(async ({ db }) => {
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
      expect(state.tags.map((tag) => tag.name)).toEqual([
        'Work',
        'Personal',
        'Projects'
      ]);
      expect(state.activeTagId).toBe('tag-1');
    });
  });

  it('separates deleted tags from active tags', async () => {
    await withClassicRealDatabase(async ({ db }) => {
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
    });
  });

  it('builds state with notes linked to tags', async () => {
    await withClassicRealDatabase(async ({ db }) => {
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
    });
  });

  it('hydrates metadata for menu-bar date and count sorting', async () => {
    await withClassicRealDatabase(async ({ db }) => {
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
    });
  });
});

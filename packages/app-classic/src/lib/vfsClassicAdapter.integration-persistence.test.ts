import { notes, tags, vfsLinks } from '@tearleads/db/sqlite';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CLASSIC_ROOT_ID,
  queryClassicData,
  seedClassicRoot,
  seedNote,
  seedTag,
  withClassicRealDatabase
} from '../test/vfsClassicAdapter.integration-test-support';
import { buildClassicStateFromVfs } from './vfsClassicAdapter';
import { buildClassicPositionUpdates } from './vfsPositionUpdates';

describe('Classic VFS Integration persistence (real database)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('persists position updates back to database', async () => {
    await withClassicRealDatabase(async ({ db }) => {
      const now = new Date();
      await seedClassicRoot(db, now);
      await seedTag(db, { id: 'tag-1', name: 'Work', position: 0, now });
      await seedTag(db, { id: 'tag-2', name: 'Personal', position: 1, now });

      const initialData = await queryClassicData(db);
      const initialState = buildClassicStateFromVfs({
        rootTagParentId: CLASSIC_ROOT_ID,
        ...initialData
      });

      expect(initialState.tags.map((tag) => tag.id)).toEqual([
        'tag-1',
        'tag-2'
      ]);

      const tag0 = initialState.tags[0];
      const tag1 = initialState.tags[1];
      if (!tag0 || !tag1) {
        throw new Error('Expected two tags');
      }

      const reorderedState = {
        ...initialState,
        tags: [tag1, tag0]
      };

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

      const reloadedData = await queryClassicData(db);
      const reloadedState = buildClassicStateFromVfs({
        rootTagParentId: CLASSIC_ROOT_ID,
        ...reloadedData
      });

      expect(reloadedState.tags.map((tag) => tag.id)).toEqual([
        'tag-2',
        'tag-1'
      ]);
    });
  });

  it('persists note reordering within a tag', async () => {
    await withClassicRealDatabase(async ({ db }) => {
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

      const reorderedState = {
        ...initialState,
        noteOrderByTagId: {
          'tag-1': ['note-3', 'note-1', 'note-2']
        }
      };

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
    });
  });

  it('handles tag rename persistence', async () => {
    await withClassicRealDatabase(async ({ db }) => {
      const now = new Date();
      await seedClassicRoot(db, now);
      await seedTag(db, {
        id: 'tag-1',
        name: 'Original Name',
        position: 0,
        now
      });

      const initialData = await queryClassicData(db);
      const initialState = buildClassicStateFromVfs({
        rootTagParentId: CLASSIC_ROOT_ID,
        ...initialData
      });
      expect(initialState.tags[0]?.name).toBe('Original Name');

      await db
        .update(tags)
        .set({ encryptedName: 'Renamed Tag' })
        .where(eq(tags.id, 'tag-1'));

      const reloadedData = await queryClassicData(db);
      const reloadedState = buildClassicStateFromVfs({
        rootTagParentId: CLASSIC_ROOT_ID,
        ...reloadedData
      });

      expect(reloadedState.tags[0]?.name).toBe('Renamed Tag');
    });
  });

  it('handles soft delete and restore of tags', async () => {
    await withClassicRealDatabase(async ({ db }) => {
      const now = new Date();
      await seedClassicRoot(db, now);
      await seedTag(db, { id: 'tag-1', name: 'My Tag', position: 0, now });

      let data = await queryClassicData(db);
      let state = buildClassicStateFromVfs({
        rootTagParentId: CLASSIC_ROOT_ID,
        ...data
      });
      expect(state.tags).toHaveLength(1);
      expect(state.deletedTags).toHaveLength(0);

      await db.update(tags).set({ deleted: true }).where(eq(tags.id, 'tag-1'));

      data = await queryClassicData(db);
      state = buildClassicStateFromVfs({
        rootTagParentId: CLASSIC_ROOT_ID,
        ...data
      });
      expect(state.tags).toHaveLength(0);
      expect(state.deletedTags).toHaveLength(1);
      expect(state.deletedTags[0]?.name).toBe('My Tag');

      await db.update(tags).set({ deleted: false }).where(eq(tags.id, 'tag-1'));

      data = await queryClassicData(db);
      state = buildClassicStateFromVfs({
        rootTagParentId: CLASSIC_ROOT_ID,
        ...data
      });
      expect(state.tags).toHaveLength(1);
      expect(state.deletedTags).toHaveLength(0);
    });
  });

  it('handles note content update persistence', async () => {
    await withClassicRealDatabase(async ({ db }) => {
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

      let data = await queryClassicData(db);
      let state = buildClassicStateFromVfs({
        rootTagParentId: CLASSIC_ROOT_ID,
        ...data
      });
      expect(state.notesById['note-1']?.title).toBe('Original Title');
      expect(state.notesById['note-1']?.body).toBe('Original content');

      await db
        .update(notes)
        .set({ title: 'Updated Title', content: 'Updated content' })
        .where(eq(notes.id, 'note-1'));

      data = await queryClassicData(db);
      state = buildClassicStateFromVfs({
        rootTagParentId: CLASSIC_ROOT_ID,
        ...data
      });
      expect(state.notesById['note-1']?.title).toBe('Updated Title');
      expect(state.notesById['note-1']?.body).toBe('Updated content');
    });
  });
});

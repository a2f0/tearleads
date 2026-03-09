import type { ClassicState, VfsLinkLikeRow } from './types';
import {
  buildClassicPositionUpdates,
  computePositionUpdatesForParent
} from './vfsPositionUpdates';

function createLinkRows(): VfsLinkLikeRow[] {
  return [
    { parentId: 'root', childId: 'tag-1', position: 0 },
    { parentId: 'root', childId: 'tag-2', position: 1 },
    { parentId: 'tag-1', childId: 'note-1', position: 0 },
    { parentId: 'tag-1', childId: 'note-2', position: 1 },
    { parentId: 'tag-2', childId: 'note-3', position: null }
  ];
}

describe('vfsPositionUpdates', () => {
  describe('computePositionUpdatesForParent', () => {
    it('returns no updates when ordering already matches positions', () => {
      const updates = computePositionUpdatesForParent(
        'root',
        ['tag-1', 'tag-2'],
        createLinkRows()
      );
      expect(updates).toEqual([]);
    });

    it('returns only changed positions', () => {
      const updates = computePositionUpdatesForParent(
        'root',
        ['tag-2', 'tag-1'],
        createLinkRows()
      );
      expect(updates).toEqual([
        { parentId: 'root', childId: 'tag-2', position: 0 },
        { parentId: 'root', childId: 'tag-1', position: 1 }
      ]);
    });

    it('deduplicates repeated ids and skips missing links', () => {
      const updates = computePositionUpdatesForParent(
        'root',
        ['tag-2', 'tag-2', 'tag-3', 'tag-1'],
        createLinkRows()
      );
      expect(updates).toEqual([
        { parentId: 'root', childId: 'tag-2', position: 0 },
        { parentId: 'root', childId: 'tag-1', position: 1 }
      ]);
    });

    it('treats null position as needing an update', () => {
      const updates = computePositionUpdatesForParent(
        'tag-2',
        ['note-3'],
        createLinkRows()
      );
      expect(updates).toEqual([
        { parentId: 'tag-2', childId: 'note-3', position: 0 }
      ]);
    });

    it('handles empty ordered ids', () => {
      const updates = computePositionUpdatesForParent(
        'root',
        [],
        createLinkRows()
      );
      expect(updates).toEqual([]);
    });
  });

  describe('buildClassicPositionUpdates', () => {
    it('combines tag and note updates', () => {
      const state: ClassicState = {
        tags: [
          { id: 'tag-2', name: 'B' },
          { id: 'tag-1', name: 'A' }
        ],
        deletedTags: [],
        notesById: {
          'note-1': { id: 'note-1', title: 'One', body: '' },
          'note-2': { id: 'note-2', title: 'Two', body: '' },
          'note-3': { id: 'note-3', title: 'Three', body: '' }
        },
        noteOrderByTagId: {
          'tag-1': ['note-2', 'note-1'],
          'tag-2': ['note-3']
        },
        activeTagId: 'tag-2'
      };

      const updates = buildClassicPositionUpdates(
        state,
        'root',
        createLinkRows()
      );
      expect(updates).toEqual([
        { parentId: 'root', childId: 'tag-2', position: 0 },
        { parentId: 'root', childId: 'tag-1', position: 1 },
        { parentId: 'tag-2', childId: 'note-3', position: 0 },
        { parentId: 'tag-1', childId: 'note-2', position: 0 },
        { parentId: 'tag-1', childId: 'note-1', position: 1 }
      ]);
    });

    it('handles missing note ordering map for a tag', () => {
      const state: ClassicState = {
        tags: [{ id: 'tag-1', name: 'A' }],
        deletedTags: [],
        notesById: {},
        noteOrderByTagId: {},
        activeTagId: 'tag-1'
      };

      const updates = buildClassicPositionUpdates(
        state,
        'root',
        createLinkRows()
      );
      expect(updates).toEqual([]);
    });
  });
});

import {
  getActiveTagNoteIds,
  moveItem,
  reorderNoteInTag,
  reorderNoteInTagToTarget,
  reorderTagToTarget,
  reorderTags,
  selectTag
} from './ordering';
import type { ClassicState } from './types';

function createState(): ClassicState {
  return {
    tags: [
      { id: 'tag-1', name: 'Work' },
      { id: 'tag-2', name: 'Personal' }
    ],
    notesById: {
      'note-1': { id: 'note-1', title: 'A', body: 'Alpha' },
      'note-2': { id: 'note-2', title: 'B', body: 'Beta' }
    },
    noteOrderByTagId: {
      'tag-1': ['note-1', 'note-2'],
      'tag-2': []
    },
    activeTagId: 'tag-1'
  };
}

describe('ordering', () => {
  describe('moveItem', () => {
    it('moves an item to a new index', () => {
      expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    });

    it('returns a shallow copy for out-of-bounds indexes', () => {
      const original = ['a', 'b'];
      expect(moveItem(original, -1, 1)).toEqual(original);
      expect(moveItem(original, 0, 9)).toEqual(original);
    });

    it('returns a shallow copy when from equals to', () => {
      const original = ['a', 'b'];
      const next = moveItem(original, 1, 1);
      expect(next).toEqual(original);
      expect(next).not.toBe(original);
    });

    it('handles sparse arrays', () => {
      const sparse = ['a', 'b'];
      // force a sparse hole to exercise undefined guard
      delete sparse[1];
      const moved = moveItem(sparse, 1, 0);
      expect(moved).toEqual(['a', undefined]);
    });
  });

  describe('reorderTags', () => {
    it('moves a tag down', () => {
      const next = reorderTags(createState(), 'tag-1', 'down');
      expect(next.tags.map((tag) => tag.id)).toEqual(['tag-2', 'tag-1']);
    });

    it('returns same state when tag is missing', () => {
      const state = createState();
      expect(reorderTags(state, 'missing', 'up')).toBe(state);
    });

    it('returns same state for boundary moves', () => {
      const state = createState();
      expect(reorderTags(state, 'tag-1', 'up')).toBe(state);
      expect(reorderTags(state, 'tag-2', 'down')).toBe(state);
    });

    it('moves a tag to a target tag position', () => {
      const next = reorderTagToTarget(createState(), 'tag-1', 'tag-2');
      expect(next.tags.map((tag) => tag.id)).toEqual(['tag-2', 'tag-1']);
    });

    it('returns same state for invalid target reorder', () => {
      const state = createState();
      expect(reorderTagToTarget(state, 'missing', 'tag-2')).toBe(state);
      expect(reorderTagToTarget(state, 'tag-1', 'missing')).toBe(state);
      expect(reorderTagToTarget(state, 'tag-1', 'tag-1')).toBe(state);
    });
  });

  describe('reorderNoteInTag', () => {
    it('moves a note up within active tag ordering', () => {
      const state = createState();
      const next = reorderNoteInTag(state, 'tag-1', 'note-2', 'up');
      expect(next.noteOrderByTagId['tag-1']).toEqual(['note-2', 'note-1']);
    });

    it('returns same state when tag has no note ordering', () => {
      const state = createState();
      expect(reorderNoteInTag(state, 'missing', 'note-1', 'up')).toBe(state);
    });

    it('returns same state when note is missing', () => {
      const state = createState();
      expect(reorderNoteInTag(state, 'tag-1', 'missing', 'up')).toBe(state);
    });

    it('returns same state for boundary moves', () => {
      const state = createState();
      expect(reorderNoteInTag(state, 'tag-1', 'note-1', 'up')).toBe(state);
      expect(reorderNoteInTag(state, 'tag-1', 'note-2', 'down')).toBe(state);
    });

    it('moves a note to a target note position', () => {
      const next = reorderNoteInTagToTarget(
        createState(),
        'tag-1',
        'note-1',
        'note-2'
      );
      expect(next.noteOrderByTagId['tag-1']).toEqual(['note-2', 'note-1']);
    });

    it('returns same state for invalid note target reorder', () => {
      const state = createState();
      expect(
        reorderNoteInTagToTarget(state, 'tag-1', 'missing', 'note-2')
      ).toBe(state);
      expect(
        reorderNoteInTagToTarget(state, 'tag-1', 'note-1', 'missing')
      ).toBe(state);
      expect(
        reorderNoteInTagToTarget(state, 'tag-1', 'note-1', 'note-1')
      ).toBe(state);
    });
  });

  describe('getActiveTagNoteIds', () => {
    it('returns empty list when active tag is null', () => {
      const state = createState();
      state.activeTagId = null;
      expect(getActiveTagNoteIds(state)).toEqual([]);
    });

    it('returns empty list when active tag has no mapping', () => {
      const state = createState();
      state.activeTagId = 'unknown';
      expect(getActiveTagNoteIds(state)).toEqual([]);
    });

    it('returns active tag notes', () => {
      expect(getActiveTagNoteIds(createState())).toEqual(['note-1', 'note-2']);
    });
  });

  describe('selectTag', () => {
    it('switches active tag when tag exists', () => {
      const next = selectTag(createState(), 'tag-2');
      expect(next.activeTagId).toBe('tag-2');
    });

    it('returns same state when tag is missing', () => {
      const state = createState();
      expect(selectTag(state, 'missing')).toBe(state);
    });

    it('returns same state when tag is already active', () => {
      const state = createState();
      expect(selectTag(state, 'tag-1')).toBe(state);
    });
  });
});

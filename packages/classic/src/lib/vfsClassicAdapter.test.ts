import type { ClassicState } from './types';
import {
  type BuildClassicStateFromVfsArgs,
  buildClassicStateFromVfs,
  serializeOrderState
} from './vfsClassicAdapter';

function createArgs(): BuildClassicStateFromVfsArgs {
  return {
    rootTagParentId: 'classic-root',
    registryRows: [
      { id: 'tag-1', objectType: 'tag' },
      { id: 'tag-2', objectType: 'tag' },
      { id: 'note-1', objectType: 'note' },
      { id: 'note-2', objectType: 'note' },
      { id: 'file-1', objectType: 'file' }
    ],
    tagRows: [
      { id: 'tag-1', encryptedName: 'Pinned', deleted: false },
      { id: 'tag-2', encryptedName: '   ', deleted: true },
      { id: 'not-a-tag', encryptedName: 'Ignored', deleted: false }
    ],
    noteRows: [
      { id: 'note-1', title: 'Alpha', content: 'Body A' },
      { id: 'note-2', title: '', content: null },
      { id: 'note-x', title: 'Ignored', content: 'Ignored' }
    ],
    linkRows: [
      { parentId: 'classic-root', childId: 'tag-2', position: 2 },
      { parentId: 'classic-root', childId: 'tag-1', position: 1 },
      { parentId: 'classic-root', childId: 'file-1', position: 0 },
      { parentId: 'tag-1', childId: 'note-2', position: 3 },
      { parentId: 'tag-1', childId: 'note-1', position: 1 },
      { parentId: 'tag-1', childId: 'file-1', position: 2 },
      { parentId: 'tag-2', childId: 'note-2', position: null },
      { parentId: 'tag-2', childId: 'note-1', position: null }
    ]
  };
}

describe('vfsClassicAdapter', () => {
  it('builds classic state with ordering and fallbacks', () => {
    const state = buildClassicStateFromVfs(createArgs());

    expect(state.tags).toEqual([{ id: 'tag-1', name: 'Pinned' }]);
    expect(state.deletedTags).toEqual([{ id: 'tag-2', name: 'Unnamed Tag' }]);

    expect(state.notesById['note-1']).toEqual({
      id: 'note-1',
      title: 'Alpha',
      body: 'Body A'
    });
    expect(state.notesById['note-2']).toEqual({
      id: 'note-2',
      title: 'Untitled Note',
      body: ''
    });

    expect(state.noteOrderByTagId['tag-1']).toEqual(['note-1', 'note-2']);
    expect(state.activeTagId).toBe('tag-1');
  });

  it('uses null active tag when no tags are linked to root', () => {
    const args = createArgs();
    args.linkRows = [{ parentId: 'tag-1', childId: 'note-1', position: 0 }];

    const state = buildClassicStateFromVfs(args);
    expect(state.tags).toEqual([]);
    expect(state.deletedTags).toEqual([]);
    expect(state.activeTagId).toBeNull();
    expect(state.noteOrderByTagId).toEqual({});
  });

  it('serializes ordering state', () => {
    const state: ClassicState = {
      tags: [
        { id: 'tag-1', name: 'A' },
        { id: 'tag-2', name: 'B' }
      ],
      deletedTags: [],
      notesById: {},
      noteOrderByTagId: { 'tag-1': ['n1'] },
      activeTagId: 'tag-1'
    };

    expect(serializeOrderState(state)).toEqual({
      tagOrder: ['tag-1', 'tag-2'],
      noteOrderByTagId: { 'tag-1': ['n1'] }
    });
  });
});

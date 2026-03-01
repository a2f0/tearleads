import {
  buildClassicSortMetadata,
  isEntrySortOrder,
  isTagSortOrder,
  sortNoteIds,
  sortTags
} from './sorting';
import type { ClassicState } from './types';

function createState(): ClassicState {
  return {
    tags: [
      { id: 'tag-1', name: 'Beta' },
      { id: 'tag-2', name: 'alpha' },
      { id: 'tag-3', name: 'Gamma' }
    ],
    deletedTags: [],
    notesById: {
      'note-1': { id: 'note-1', title: 'Zulu', body: 'ccc' },
      'note-2': { id: 'note-2', title: 'alpha', body: 'aaa' },
      'note-3': { id: 'note-3', title: 'Beta', body: 'bbb' }
    },
    noteOrderByTagId: {
      'tag-1': ['note-1', 'note-2'],
      'tag-2': ['note-2', 'note-3'],
      'tag-3': []
    },
    activeTagId: 'tag-1',
    sortMetadata: {
      tagCreatedAtById: {
        'tag-1': 2000,
        'tag-2': 1000,
        'tag-3': null
      },
      tagLastUsedAtById: {
        'tag-1': 5000,
        'tag-2': 7000,
        'tag-3': 100
      },
      noteCreatedAtById: {
        'note-1': 4000,
        'note-2': 2000,
        'note-3': null
      },
      noteUpdatedAtById: {
        'note-1': 9000,
        'note-2': 8000,
        'note-3': 7000
      },
      noteTaggedAtByTagId: {
        'tag-1': {
          'note-1': 10,
          'note-2': 20
        },
        'tag-2': {
          'note-2': 30,
          'note-3': 40
        }
      }
    }
  };
}

describe('sorting', () => {
  it('validates sort order values', () => {
    expect(isTagSortOrder('name-asc')).toBe(true);
    expect(isTagSortOrder('invalid')).toBe(false);
    expect(isEntrySortOrder('date-updated-desc')).toBe(true);
    expect(isEntrySortOrder('invalid')).toBe(false);
  });

  it('sorts tags by all supported orders', () => {
    const state = createState();

    expect(
      sortTags({ state, tags: state.tags, sortOrder: 'user-defined' }).map(
        (tag) => tag.id
      )
    ).toEqual(['tag-1', 'tag-2', 'tag-3']);
    expect(
      sortTags({ state, tags: state.tags, sortOrder: 'name-asc' }).map(
        (tag) => tag.id
      )
    ).toEqual(['tag-2', 'tag-1', 'tag-3']);
    expect(
      sortTags({ state, tags: state.tags, sortOrder: 'name-desc' }).map(
        (tag) => tag.id
      )
    ).toEqual(['tag-3', 'tag-1', 'tag-2']);
    expect(
      sortTags({
        state,
        tags: state.tags,
        sortOrder: 'date-created-asc'
      }).map((tag) => tag.id)
    ).toEqual(['tag-2', 'tag-1', 'tag-3']);
    expect(
      sortTags({
        state,
        tags: state.tags,
        sortOrder: 'date-created-desc'
      }).map((tag) => tag.id)
    ).toEqual(['tag-1', 'tag-2', 'tag-3']);
    expect(
      sortTags({
        state,
        tags: state.tags,
        sortOrder: 'entry-count-asc'
      }).map((tag) => tag.id)
    ).toEqual(['tag-3', 'tag-1', 'tag-2']);
    expect(
      sortTags({
        state,
        tags: state.tags,
        sortOrder: 'entry-count-desc'
      }).map((tag) => tag.id)
    ).toEqual(['tag-1', 'tag-2', 'tag-3']);
    expect(
      sortTags({
        state,
        tags: state.tags,
        sortOrder: 'date-last-used-asc'
      }).map((tag) => tag.id)
    ).toEqual(['tag-3', 'tag-1', 'tag-2']);
    expect(
      sortTags({
        state,
        tags: state.tags,
        sortOrder: 'date-last-used-desc'
      }).map((tag) => tag.id)
    ).toEqual(['tag-2', 'tag-1', 'tag-3']);
  });

  it('handles null timestamp edge cases when sorting tags by date', () => {
    const state = createState();
    const sortMetadata = state.sortMetadata;
    if (!sortMetadata) {
      throw new Error('Expected sort metadata');
    }

    state.sortMetadata = {
      ...sortMetadata,
      tagCreatedAtById: {
        'tag-1': null,
        'tag-2': null,
        'tag-3': 100
      },
      tagLastUsedAtById: {
        'tag-1': 1,
        'tag-2': 2,
        'tag-3': 3
      }
    };

    expect(
      sortTags({
        state,
        tags: [
          { id: 'tag-1', name: 'A' },
          { id: 'tag-2', name: 'B' }
        ],
        sortOrder: 'date-created-asc'
      }).map((tag) => tag.id)
    ).toEqual(['tag-1', 'tag-2']);

    expect(
      sortTags({
        state,
        tags: [
          { id: 'tag-3', name: 'C' },
          { id: 'tag-1', name: 'A' }
        ],
        sortOrder: 'date-created-asc'
      }).map((tag) => tag.id)
    ).toEqual(['tag-3', 'tag-1']);
  });

  it('sorts notes by all supported orders', () => {
    const state = createState();
    const noteIds = ['note-1', 'note-2', 'note-3'];
    const activeTagNoteIds = ['note-2', 'note-1'];

    expect(
      sortNoteIds({
        state,
        noteIds,
        activeTagId: 'tag-1',
        sortOrder: 'user-defined'
      })
    ).toEqual(['note-1', 'note-2', 'note-3']);
    expect(
      sortNoteIds({
        state,
        noteIds: activeTagNoteIds,
        activeTagId: 'tag-1',
        sortOrder: 'date-tagged-asc'
      })
    ).toEqual(['note-1', 'note-2']);
    expect(
      sortNoteIds({
        state,
        noteIds: activeTagNoteIds,
        activeTagId: 'tag-1',
        sortOrder: 'date-tagged-desc'
      })
    ).toEqual(['note-2', 'note-1']);
    expect(
      sortNoteIds({
        state,
        noteIds,
        activeTagId: 'tag-1',
        sortOrder: 'subject-asc'
      })
    ).toEqual(['note-2', 'note-3', 'note-1']);
    expect(
      sortNoteIds({
        state,
        noteIds,
        activeTagId: 'tag-1',
        sortOrder: 'subject-desc'
      })
    ).toEqual(['note-1', 'note-3', 'note-2']);
    expect(
      sortNoteIds({
        state,
        noteIds,
        activeTagId: 'tag-1',
        sortOrder: 'body-asc'
      })
    ).toEqual(['note-2', 'note-3', 'note-1']);
    expect(
      sortNoteIds({
        state,
        noteIds,
        activeTagId: 'tag-1',
        sortOrder: 'body-desc'
      })
    ).toEqual(['note-1', 'note-3', 'note-2']);
    expect(
      sortNoteIds({
        state,
        noteIds,
        activeTagId: 'tag-1',
        sortOrder: 'date-created-asc'
      })
    ).toEqual(['note-2', 'note-1', 'note-3']);
    expect(
      sortNoteIds({
        state,
        noteIds,
        activeTagId: 'tag-1',
        sortOrder: 'date-created-desc'
      })
    ).toEqual(['note-1', 'note-2', 'note-3']);
    expect(
      sortNoteIds({
        state,
        noteIds,
        activeTagId: 'tag-1',
        sortOrder: 'date-updated-asc'
      })
    ).toEqual(['note-3', 'note-2', 'note-1']);
    expect(
      sortNoteIds({
        state,
        noteIds,
        activeTagId: 'tag-1',
        sortOrder: 'date-updated-desc'
      })
    ).toEqual(['note-1', 'note-2', 'note-3']);
    expect(
      sortNoteIds({
        state,
        noteIds,
        activeTagId: 'tag-1',
        sortOrder: 'tag-count-asc'
      })
    ).toEqual(['note-1', 'note-3', 'note-2']);
    expect(
      sortNoteIds({
        state,
        noteIds,
        activeTagId: 'tag-1',
        sortOrder: 'tag-count-desc'
      })
    ).toEqual(['note-2', 'note-1', 'note-3']);
  });

  it('falls back to current ordering for date-tagged sorting when no tag is selected', () => {
    const state = createState();

    expect(
      sortNoteIds({
        state,
        noteIds: ['note-2', 'note-1'],
        activeTagId: null,
        sortOrder: 'date-tagged-desc'
      })
    ).toEqual(['note-2', 'note-1']);
  });

  it('builds sort metadata from VFS rows', () => {
    const metadata = buildClassicSortMetadata({
      registryRows: [
        {
          id: 'tag-1',
          objectType: 'tag',
          createdAt: new Date('2024-01-01T00:00:00.000Z')
        },
        {
          id: 'note-1',
          objectType: 'note',
          createdAt: new Date('2024-01-02T00:00:00.000Z')
        },
        {
          id: 'note-2',
          objectType: 'note',
          createdAt: null
        }
      ],
      noteRows: [
        {
          id: 'note-1',
          createdAt: new Date('2024-01-03T00:00:00.000Z'),
          updatedAt: new Date('2024-01-04T00:00:00.000Z')
        },
        {
          id: 'note-2',
          createdAt: null,
          updatedAt: null
        }
      ],
      linkRows: [
        {
          parentId: 'tag-1',
          childId: 'note-1',
          createdAt: new Date('2024-01-05T00:00:00.000Z')
        },
        {
          parentId: 'tag-1',
          childId: 'note-2',
          createdAt: null
        },
        {
          parentId: 'tag-2',
          childId: 'note-2',
          createdAt: new Date('2024-01-06T00:00:00.000Z')
        }
      ]
    });

    expect(metadata).toEqual({
      tagCreatedAtById: {
        'tag-1': new Date('2024-01-01T00:00:00.000Z').getTime()
      },
      tagLastUsedAtById: {
        'tag-1': new Date('2024-01-05T00:00:00.000Z').getTime()
      },
      noteCreatedAtById: {
        'note-1': new Date('2024-01-03T00:00:00.000Z').getTime(),
        'note-2': null
      },
      noteUpdatedAtById: {
        'note-1': new Date('2024-01-04T00:00:00.000Z').getTime(),
        'note-2': null
      },
      noteTaggedAtByTagId: {
        'tag-1': {
          'note-1': new Date('2024-01-05T00:00:00.000Z').getTime(),
          'note-2': null
        },
        'tag-2': {
          'note-2': new Date('2024-01-06T00:00:00.000Z').getTime()
        }
      }
    });
  });
});

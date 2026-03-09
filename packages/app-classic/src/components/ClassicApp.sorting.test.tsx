import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ClassicState } from '../lib/types';
import { ClassicApp } from './ClassicApp';

function createState(activeTagId: string | null = 'tag-1'): ClassicState {
  return {
    tags: [
      { id: 'tag-1', name: 'Work' },
      { id: 'tag-2', name: 'Personal' }
    ],
    deletedTags: [],
    notesById: {
      'note-1': { id: 'note-1', title: 'Alpha', body: 'A' },
      'note-2': { id: 'note-2', title: 'Beta', body: 'B' },
      'note-3': { id: 'note-3', title: 'Gamma', body: 'G' }
    },
    noteOrderByTagId: {
      'tag-1': ['note-1', 'note-2'],
      'tag-2': ['note-2', 'note-3']
    },
    activeTagId
  };
}

describe('ClassicApp - Sorting', () => {
  it('sorts tags via menu bar and can switch back to user-defined order', () => {
    const state: ClassicState = {
      tags: [
        { id: 'tag-1', name: 'Work' },
        { id: 'tag-2', name: 'Personal' },
        { id: 'tag-3', name: 'Alpha' }
      ],
      deletedTags: [],
      notesById: {},
      noteOrderByTagId: {
        'tag-1': [],
        'tag-2': [],
        'tag-3': []
      },
      activeTagId: 'tag-1'
    };

    render(<ClassicApp initialState={state} />);

    const tagSort = screen.getByLabelText('Sort tags');
    const tagList = screen.getByLabelText('Tag List');

    const getTagLabels = (): string[] =>
      within(tagList)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label') ?? '');

    expect(getTagLabels()).toEqual([
      'Select tag Work',
      'Select tag Personal',
      'Select tag Alpha'
    ]);

    fireEvent.change(tagSort, { target: { value: 'name-asc' } });
    expect(getTagLabels()).toEqual([
      'Select tag Alpha',
      'Select tag Personal',
      'Select tag Work'
    ]);

    fireEvent.change(tagSort, { target: { value: 'user-defined' } });
    expect(getTagLabels()).toEqual([
      'Select tag Work',
      'Select tag Personal',
      'Select tag Alpha'
    ]);
  });

  it('sorts entries via menu bar using date-tagged and subject modes', () => {
    const state: ClassicState = {
      tags: [{ id: 'tag-1', name: 'Work' }],
      deletedTags: [],
      notesById: {
        'note-1': { id: 'note-1', title: 'Zulu', body: 'Body Z' },
        'note-2': { id: 'note-2', title: 'Alpha', body: 'Body A' }
      },
      noteOrderByTagId: {
        'tag-1': ['note-1', 'note-2']
      },
      activeTagId: 'tag-1',
      sortMetadata: {
        tagCreatedAtById: {
          'tag-1': 1
        },
        tagLastUsedAtById: {
          'tag-1': 2
        },
        noteCreatedAtById: {
          'note-1': 1,
          'note-2': 2
        },
        noteUpdatedAtById: {
          'note-1': 3,
          'note-2': 4
        },
        noteTaggedAtByTagId: {
          'tag-1': {
            'note-1': 100,
            'note-2': 200
          }
        }
      }
    };

    render(<ClassicApp initialState={state} />);

    const entrySort = screen.getByLabelText('Sort entries');

    const getEntryTitles = (): string[] =>
      within(screen.getByLabelText('Note List'))
        .getAllByRole('heading', { level: 3 })
        .map((heading) => heading.textContent ?? '');

    expect(getEntryTitles()).toEqual(['Zulu', 'Alpha']);

    fireEvent.change(entrySort, { target: { value: 'date-tagged-desc' } });
    expect(getEntryTitles()).toEqual(['Alpha', 'Zulu']);

    fireEvent.change(entrySort, { target: { value: 'subject-asc' } });
    expect(getEntryTitles()).toEqual(['Alpha', 'Zulu']);
  });

  it('uses external sort callbacks when sort orders are controlled', () => {
    const onTagSortOrderChange = vi.fn();
    const onEntrySortOrderChange = vi.fn();

    render(
      <ClassicApp
        initialState={createState()}
        tagSortOrder="user-defined"
        entrySortOrder="user-defined"
        onTagSortOrderChange={onTagSortOrderChange}
        onEntrySortOrderChange={onEntrySortOrderChange}
      />
    );

    fireEvent.change(screen.getByLabelText('Sort tags'), {
      target: { value: 'name-asc' }
    });
    fireEvent.change(screen.getByLabelText('Sort entries'), {
      target: { value: 'subject-asc' }
    });

    expect(onTagSortOrderChange).toHaveBeenCalledWith('name-asc');
    expect(onEntrySortOrderChange).toHaveBeenCalledWith('subject-asc');
  });

  it('hides internal sort controls when showSortControls is false', () => {
    render(
      <ClassicApp initialState={createState()} showSortControls={false} />
    );

    expect(screen.queryByLabelText('Sort tags')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Sort entries')).not.toBeInTheDocument();
  });
});

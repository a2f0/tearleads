import { fireEvent, render, screen } from '@testing-library/react';
import type { Mock } from 'vitest';
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

function isClassicState(value: unknown): value is ClassicState {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  if (!('tags' in value) || !Array.isArray(value.tags)) {
    return false;
  }

  if (!('deletedTags' in value) || !Array.isArray(value.deletedTags)) {
    return false;
  }

  if (!('notesById' in value) || typeof value.notesById !== 'object') {
    return false;
  }

  if (
    !('noteOrderByTagId' in value) ||
    typeof value.noteOrderByTagId !== 'object'
  ) {
    return false;
  }

  return 'activeTagId' in value;
}

function getLastState(onStateChange: Mock): ClassicState {
  const lastCall = onStateChange.mock.lastCall;
  if (!lastCall) {
    throw new Error('Expected at least one state change callback');
  }

  const [candidate] = lastCall;
  if (!isClassicState(candidate)) {
    throw new Error('Callback payload is not a ClassicState');
  }

  return candidate;
}

describe('ClassicApp - Context menu actions', () => {
  it('creates a new tag via context menu and enters edit mode', () => {
    const onStateChange = vi.fn();
    render(
      <ClassicApp initialState={createState()} onStateChange={onStateChange} />
    );

    const tagPane = screen
      .getByLabelText('Tags Sidebar')
      .querySelector('.overflow-auto');
    if (!tagPane) {
      throw new Error('Expected tag pane');
    }
    fireEvent.contextMenu(tagPane);
    fireEvent.click(screen.getByLabelText('Create new tag'));

    expect(screen.getByLabelText(/Edit tag/)).toBeInTheDocument();
    const latest = getLastState(onStateChange);
    expect(latest.tags).toHaveLength(3);
    expect(latest.tags[2]?.name).toBe('New Tag');
  });

  it('creates a new entry via context menu and enters edit mode', () => {
    const onStateChange = vi.fn();
    render(
      <ClassicApp initialState={createState()} onStateChange={onStateChange} />
    );

    const entryPane = screen
      .getByLabelText('Notes Pane')
      .querySelector('.overflow-auto');
    if (!entryPane) {
      throw new Error('Expected entry pane');
    }
    fireEvent.contextMenu(entryPane);
    fireEvent.click(screen.getByLabelText('Create new entry'));

    expect(screen.getByLabelText('Edit entry title')).toBeInTheDocument();
    const latest = getLastState(onStateChange);
    expect(Object.keys(latest.notesById)).toHaveLength(4);
  });

  it('soft-deletes a tag into deleted section and calls onDeleteTag', () => {
    const onDeleteTag = vi.fn();
    render(
      <ClassicApp initialState={createState()} onDeleteTag={onDeleteTag} />
    );

    fireEvent.contextMenu(screen.getByLabelText('Select tag Work'));
    fireEvent.click(screen.getByLabelText('Delete tag Work'));

    expect(onDeleteTag).toHaveBeenCalledWith('tag-1');
    expect(screen.getByText('Deleted Tags (1)')).toBeInTheDocument();
    expect(screen.getByText('Work')).toBeInTheDocument();
  });
});

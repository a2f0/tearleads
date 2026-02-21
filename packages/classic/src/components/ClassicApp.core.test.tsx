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

describe('ClassicApp - Core functionality', () => {
  it('reorders tags, selects tags, and reorders notes', () => {
    const onStateChange = vi.fn();
    render(
      <ClassicApp initialState={createState()} onStateChange={onStateChange} />
    );

    fireEvent.contextMenu(screen.getByText('Beta'));
    fireEvent.click(screen.getByLabelText('Move note Beta up'));
    let latest = getLastState(onStateChange);
    expect(latest.noteOrderByTagId['tag-1']).toEqual(['note-2', 'note-1']);

    fireEvent.contextMenu(screen.getByLabelText('Select tag Work'));
    fireEvent.click(screen.getByLabelText('Move tag Work down'));
    latest = getLastState(onStateChange);
    expect(latest.tags.map((tag) => tag.id)).toEqual(['tag-2', 'tag-1']);

    fireEvent.click(screen.getByLabelText('Select tag Personal'));
    latest = getLastState(onStateChange);
    expect(latest.activeTagId).toBe('tag-2');

    fireEvent.contextMenu(screen.getByText('Beta'));
    fireEvent.click(screen.getByLabelText('Move note Beta down'));
    latest = getLastState(onStateChange);
    expect(latest.noteOrderByTagId['tag-2']).toEqual(['note-3', 'note-2']);
  });

  it('updates active tag background when selecting a tag', () => {
    render(<ClassicApp initialState={createState()} />);

    const workTagItem = screen.getByLabelText('Select tag Work').closest('li');
    const personalTagItem = screen
      .getByLabelText('Select tag Personal')
      .closest('li');
    if (!workTagItem || !personalTagItem) {
      throw new Error('Expected tag list items');
    }

    expect(workTagItem).toHaveStyle({ backgroundColor: '#e0f2fe' });
    expect(personalTagItem).not.toHaveStyle({ backgroundColor: '#e0f2fe' });

    fireEvent.click(screen.getByLabelText('Select tag Personal'));

    expect(workTagItem).not.toHaveStyle({ backgroundColor: '#e0f2fe' });
    expect(personalTagItem).toHaveStyle({ backgroundColor: '#e0f2fe' });
  });

  it('reorders tags and notes via drag handle hover', () => {
    const onStateChange = vi.fn();
    const dataTransfer = {
      effectAllowed: 'move',
      setData: vi.fn()
    } as unknown as DataTransfer;

    render(
      <ClassicApp initialState={createState()} onStateChange={onStateChange} />
    );

    const [firstTagHandle] = screen.getAllByTitle('Drag tag');
    if (!firstTagHandle) {
      throw new Error('Expected first tag drag handle');
    }
    fireEvent.mouseDown(firstTagHandle);
    fireEvent.dragStart(firstTagHandle, { dataTransfer });
    const personalTag = screen
      .getByLabelText('Select tag Personal')
      .closest('li');
    if (!personalTag) {
      throw new Error('Expected personal tag list item');
    }
    fireEvent.dragOver(personalTag);

    let latest = getLastState(onStateChange);
    expect(latest.tags.map((tag) => tag.id)).toEqual(['tag-2', 'tag-1']);

    const [firstNoteHandle] = screen.getAllByTitle('Drag entry');
    if (!firstNoteHandle) {
      throw new Error('Expected first note drag handle');
    }
    fireEvent.mouseDown(firstNoteHandle);
    fireEvent.dragStart(firstNoteHandle, { dataTransfer });
    const betaNote = screen.getByText('Beta').closest('li');
    if (!betaNote) {
      throw new Error('Expected beta note list item');
    }
    fireEvent.dragOver(betaNote);

    latest = getLastState(onStateChange);
    expect(latest.noteOrderByTagId['tag-1']).toEqual(['note-2', 'note-1']);
  });

  it('renders all entries when no active tag and supports optional callback omission', () => {
    render(<ClassicApp initialState={createState(null)} />);
    // With no active tag, should show all entries
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
    expect(screen.getByText('Gamma')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Select tag Work'));
    // After selecting a tag, only that tag's entries are shown
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
    expect(screen.queryByText('Gamma')).not.toBeInTheDocument();
  });
});

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
    notesById: {
      'note-1': { id: 'note-1', title: 'Alpha', body: 'A' },
      'note-2': { id: 'note-2', title: 'Beta', body: 'B' }
    },
    noteOrderByTagId: {
      'tag-1': ['note-1', 'note-2'],
      'tag-2': ['note-2']
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

describe('ClassicApp', () => {
  it('reorders tags, selects tags, and reorders notes', () => {
    const onStateChange = vi.fn();
    render(<ClassicApp initialState={createState()} onStateChange={onStateChange} />);

    fireEvent.click(screen.getByLabelText('Move note Beta up'));
    let latest = getLastState(onStateChange);
    expect(latest.noteOrderByTagId['tag-1']).toEqual(['note-2', 'note-1']);

    fireEvent.click(screen.getByLabelText('Move tag Work down'));
    latest = getLastState(onStateChange);
    expect(latest.tags.map((tag) => tag.id)).toEqual(['tag-2', 'tag-1']);

    fireEvent.click(screen.getByLabelText('Select tag Personal'));
    latest = getLastState(onStateChange);
    expect(latest.activeTagId).toBe('tag-2');

    fireEvent.click(screen.getByLabelText('Move note Beta down'));
    latest = getLastState(onStateChange);
    expect(latest.noteOrderByTagId['tag-2']).toEqual(['note-2']);
  });

  it('renders with no active tag and supports optional callback omission', () => {
    render(<ClassicApp initialState={createState(null)} />);
    expect(screen.getByText('Select a tag to view notes.')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Select tag Work'));
    expect(screen.getByText('Notes in Work')).toBeInTheDocument();
  });
});

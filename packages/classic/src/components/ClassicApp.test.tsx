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
    expect(latest.noteOrderByTagId['tag-2']).toEqual(['note-2']);
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

  it('renders with no active tag and supports optional callback omission', () => {
    render(<ClassicApp initialState={createState(null)} />);
    expect(screen.getByText('Select a tag to view notes.')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Select tag Work'));
    expect(screen.getByText('Alpha')).toBeInTheDocument();
  });

  it('filters tags based on tag search input', () => {
    render(<ClassicApp initialState={createState()} />);

    expect(screen.getByLabelText('Select tag Work')).toBeInTheDocument();
    expect(screen.getByLabelText('Select tag Personal')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Search tags'), {
      target: { value: 'work' }
    });

    expect(screen.getByLabelText('Select tag Work')).toBeInTheDocument();
    expect(
      screen.queryByLabelText('Select tag Personal')
    ).not.toBeInTheDocument();
  });

  it('filters notes based on entry search input', () => {
    render(<ClassicApp initialState={createState()} />);

    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Search entries'), {
      target: { value: 'alpha' }
    });

    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.queryByText('Beta')).not.toBeInTheDocument();
  });

  it('filters notes by body content', () => {
    const stateWithBody = createState();
    const note1 = stateWithBody.notesById['note-1'];
    const note2 = stateWithBody.notesById['note-2'];
    if (note1) note1.body = 'Contains keyword xyz';
    if (note2) note2.body = 'Other content';

    render(<ClassicApp initialState={stateWithBody} />);

    fireEvent.change(screen.getByLabelText('Search entries'), {
      target: { value: 'xyz' }
    });

    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.queryByText('Beta')).not.toBeInTheDocument();
  });

  it('shows all items when search is cleared', () => {
    render(<ClassicApp initialState={createState()} />);

    const tagInput = screen.getByLabelText('Search tags');
    fireEvent.change(tagInput, { target: { value: 'work' } });
    expect(
      screen.queryByLabelText('Select tag Personal')
    ).not.toBeInTheDocument();

    fireEvent.change(tagInput, { target: { value: '' } });
    expect(screen.getByLabelText('Select tag Personal')).toBeInTheDocument();
  });

  it('handles case-insensitive search', () => {
    render(<ClassicApp initialState={createState()} />);

    fireEvent.change(screen.getByLabelText('Search tags'), {
      target: { value: 'WORK' }
    });

    expect(screen.getByLabelText('Select tag Work')).toBeInTheDocument();
    expect(
      screen.queryByLabelText('Select tag Personal')
    ).not.toBeInTheDocument();
  });

  it('handles missing note in notesById during entry search', () => {
    const stateWithMissingNote: ClassicState = {
      tags: [{ id: 'tag-1', name: 'Work' }],
      notesById: {
        'note-1': { id: 'note-1', title: 'Alpha', body: 'A' }
      },
      noteOrderByTagId: {
        'tag-1': ['note-1', 'note-missing']
      },
      activeTagId: 'tag-1'
    };

    render(<ClassicApp initialState={stateWithMissingNote} />);

    fireEvent.change(screen.getByLabelText('Search entries'), {
      target: { value: 'alpha' }
    });

    expect(screen.getByText('Alpha')).toBeInTheDocument();
  });
});

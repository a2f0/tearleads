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
      deletedTags: [],
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

  it('toggles focus between tag and entry search with Tab', () => {
    render(<ClassicApp initialState={createState()} />);

    const tagSearch = screen.getByLabelText('Search tags');
    const entrySearch = screen.getByLabelText('Search entries');

    tagSearch.focus();
    expect(tagSearch).toHaveFocus();

    fireEvent.keyDown(tagSearch, { key: 'Tab' });
    expect(entrySearch).toHaveFocus();

    fireEvent.keyDown(entrySearch, { key: 'Tab' });
    expect(tagSearch).toHaveFocus();
  });

  it('keeps focus in place for non-Tab keys in search fields', () => {
    render(<ClassicApp initialState={createState()} />);

    const tagSearch = screen.getByLabelText('Search tags');
    const entrySearch = screen.getByLabelText('Search entries');

    tagSearch.focus();
    fireEvent.keyDown(tagSearch, { key: 'Enter' });
    expect(tagSearch).toHaveFocus();

    entrySearch.focus();
    fireEvent.keyDown(entrySearch, { key: 'Escape' });
    expect(entrySearch).toHaveFocus();
  });

  it('keeps the editing tag visible when a tag search would otherwise hide it', () => {
    render(<ClassicApp initialState={createState()} />);

    fireEvent.contextMenu(screen.getByLabelText('Select tag Personal'));
    fireEvent.click(screen.getByLabelText('Edit tag Personal'));

    fireEvent.change(screen.getByLabelText('Search tags'), {
      target: { value: 'work' }
    });

    expect(screen.getByLabelText('Edit tag Personal')).toBeInTheDocument();
    expect(screen.getByLabelText('Select tag Work')).toBeInTheDocument();
  });

  it('keeps the editing entry visible when an entry search would otherwise hide it', () => {
    render(<ClassicApp initialState={createState()} />);

    fireEvent.contextMenu(screen.getByText('Beta'));
    fireEvent.click(screen.getByLabelText('Edit note Beta'));

    fireEvent.change(screen.getByLabelText('Search entries'), {
      target: { value: 'gamma' }
    });

    expect(screen.getByLabelText('Edit entry title')).toBeInTheDocument();
  });

  it('restores focus to tag search after renaming a tag', async () => {
    render(<ClassicApp initialState={createState()} />);

    const tagSearch = screen.getByLabelText('Search tags');
    tagSearch.focus();
    expect(tagSearch).toHaveFocus();

    fireEvent.contextMenu(screen.getByLabelText('Select tag Work'));
    fireEvent.click(screen.getByLabelText('Edit tag Work'));

    const editInput = screen.getByLabelText('Edit tag Work');
    await vi.waitFor(() => {
      expect(editInput).toHaveFocus();
    });

    fireEvent.change(editInput, { target: { value: 'Work Updated' } });
    fireEvent.keyDown(editInput, { key: 'Enter' });

    await vi.waitFor(() => {
      expect(tagSearch).toHaveFocus();
    });
  });

  it('restores focus to tag search after canceling tag edit', async () => {
    render(<ClassicApp initialState={createState()} />);

    const tagSearch = screen.getByLabelText('Search tags');
    tagSearch.focus();

    fireEvent.contextMenu(screen.getByLabelText('Select tag Work'));
    fireEvent.click(screen.getByLabelText('Edit tag Work'));

    const editInput = screen.getByLabelText('Edit tag Work');
    fireEvent.keyDown(editInput, { key: 'Escape' });

    await vi.waitFor(() => {
      expect(tagSearch).toHaveFocus();
    });
  });

  it('restores focus to entry search after updating a note', async () => {
    render(<ClassicApp initialState={createState()} />);

    const entrySearch = screen.getByLabelText('Search entries');
    entrySearch.focus();
    expect(entrySearch).toHaveFocus();

    fireEvent.contextMenu(screen.getByText('Alpha'));
    fireEvent.click(screen.getByLabelText('Edit note Alpha'));

    const editInput = screen.getByLabelText('Edit entry title');
    await vi.waitFor(() => {
      expect(editInput).toHaveFocus();
    });

    fireEvent.change(editInput, { target: { value: 'Alpha Updated' } });
    fireEvent.keyDown(editInput, { key: 'Enter' });

    await vi.waitFor(() => {
      expect(entrySearch).toHaveFocus();
    });
  });

  it('restores focus to entry search after canceling note edit', async () => {
    render(<ClassicApp initialState={createState()} />);

    const entrySearch = screen.getByLabelText('Search entries');
    entrySearch.focus();

    fireEvent.contextMenu(screen.getByText('Alpha'));
    fireEvent.click(screen.getByLabelText('Edit note Alpha'));

    const editInput = screen.getByLabelText('Edit entry title');
    await vi.waitFor(() => {
      expect(editInput).toHaveFocus();
    });

    fireEvent.keyDown(editInput, { key: 'Escape' });

    await vi.waitFor(() => {
      expect(entrySearch).toHaveFocus();
    });
  });

  it('restores focus to tag search after creating and naming a new tag', async () => {
    render(<ClassicApp initialState={createState()} />);

    const tagSearch = screen.getByLabelText('Search tags');
    tagSearch.focus();

    const tagPane = screen
      .getByLabelText('Tags Sidebar')
      .querySelector('.overflow-auto');
    if (!tagPane) {
      throw new Error('Expected tag pane');
    }
    fireEvent.contextMenu(tagPane);
    fireEvent.click(screen.getByLabelText('Create new tag'));

    const editInput = screen.getByLabelText(/Edit tag/);
    fireEvent.change(editInput, { target: { value: 'My New Tag' } });
    fireEvent.keyDown(editInput, { key: 'Enter' });

    await vi.waitFor(() => {
      expect(tagSearch).toHaveFocus();
    });
  });

  it('restores focus to entry search after creating and naming a new note', async () => {
    render(<ClassicApp initialState={createState()} />);

    const entrySearch = screen.getByLabelText('Search entries');
    entrySearch.focus();

    const entryPane = screen
      .getByLabelText('Notes Pane')
      .querySelector('.overflow-auto');
    if (!entryPane) {
      throw new Error('Expected entry pane');
    }
    fireEvent.contextMenu(entryPane);
    fireEvent.click(screen.getByLabelText('Create new entry'));

    const editInput = screen.getByLabelText('Edit entry title');
    await vi.waitFor(() => {
      expect(editInput).toHaveFocus();
    });

    fireEvent.change(editInput, { target: { value: 'My New Note' } });
    fireEvent.keyDown(editInput, { key: 'Enter' });

    await vi.waitFor(() => {
      expect(entrySearch).toHaveFocus();
    });
  });

  it('defaults to tag search when editing starts with no search focused', async () => {
    render(<ClassicApp initialState={createState()} />);

    const tagSearch = screen.getByLabelText('Search tags');

    fireEvent.contextMenu(screen.getByLabelText('Select tag Work'));
    fireEvent.click(screen.getByLabelText('Edit tag Work'));

    const editInput = screen.getByLabelText('Edit tag Work');
    fireEvent.change(editInput, { target: { value: 'Work Updated' } });
    fireEvent.keyDown(editInput, { key: 'Enter' });

    await vi.waitFor(() => {
      expect(tagSearch).toHaveFocus();
    });
  });

  it('highlights matching text in tag names when searching', () => {
    render(<ClassicApp initialState={createState()} />);

    fireEvent.change(screen.getByLabelText('Search tags'), {
      target: { value: 'ork' }
    });

    const tagButton = screen.getByLabelText('Select tag Work');
    const mark = tagButton.querySelector('mark');
    expect(mark).toBeInTheDocument();
    expect(mark).toHaveTextContent('ork');
  });

  it('highlights matching text in entry titles when searching', () => {
    render(<ClassicApp initialState={createState()} />);

    fireEvent.change(screen.getByLabelText('Search entries'), {
      target: { value: 'lph' }
    });

    const noteList = screen.getByLabelText('Note List');
    const mark = noteList.querySelector('mark');
    expect(mark).toBeInTheDocument();
    expect(mark).toHaveTextContent('lph');
  });

  it('highlights matching text in entry body when searching', () => {
    const stateWithBody = createState();
    const note1 = stateWithBody.notesById['note-1'];
    if (note1) note1.body = 'Contains keyword xyz here';

    render(<ClassicApp initialState={stateWithBody} />);

    fireEvent.change(screen.getByLabelText('Search entries'), {
      target: { value: 'xyz' }
    });

    const noteList = screen.getByLabelText('Note List');
    const mark = noteList.querySelector('mark');
    expect(mark).toBeInTheDocument();
    expect(mark).toHaveTextContent('xyz');
  });
});

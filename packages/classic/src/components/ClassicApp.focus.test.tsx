import { fireEvent, render, screen } from '@testing-library/react';
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

describe('ClassicApp - Focus management', () => {
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
});

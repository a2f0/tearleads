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

describe('ClassicApp - Callbacks', () => {
  it('calls onCreateTag when saving a new tag with placeholder name', async () => {
    const onCreateTag = vi.fn();
    const onRenameTag = vi.fn();

    render(
      <ClassicApp
        initialState={createState()}
        onCreateTag={onCreateTag}
        onRenameTag={onRenameTag}
      />
    );

    // Create a new tag (enters edit mode with placeholder name)
    fireEvent.contextMenu(
      screen.getByLabelText('Tag list, press Shift+F10 for context menu')
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Create new tag' }));

    // Edit and save the tag name
    await vi.waitFor(() => {
      expect(screen.getByLabelText('Edit tag New Tag')).toBeInTheDocument();
    });
    const editInput = screen.getByLabelText('Edit tag New Tag');
    fireEvent.change(editInput, { target: { value: 'My New Tag' } });
    fireEvent.click(screen.getByLabelText('Save tag name'));

    expect(onCreateTag).toHaveBeenCalledTimes(1);
    expect(onCreateTag.mock.calls[0]?.[1]).toBe('My New Tag');
    expect(onRenameTag).not.toHaveBeenCalled();
  });

  it('calls onRenameTag when renaming an existing tag', async () => {
    const onCreateTag = vi.fn();
    const onRenameTag = vi.fn();

    render(
      <ClassicApp
        initialState={createState()}
        onCreateTag={onCreateTag}
        onRenameTag={onRenameTag}
      />
    );

    // Start editing an existing tag
    fireEvent.contextMenu(screen.getByLabelText('Select tag Work'));
    fireEvent.click(screen.getByLabelText('Edit tag Work'));

    // Change the name and save
    await vi.waitFor(() => {
      expect(screen.getByLabelText('Edit tag Work')).toBeInTheDocument();
    });
    const editInput = screen.getByLabelText('Edit tag Work');
    fireEvent.change(editInput, { target: { value: 'Projects' } });
    fireEvent.click(screen.getByLabelText('Save tag name'));

    expect(onRenameTag).toHaveBeenCalledWith('tag-1', 'Projects');
    expect(onCreateTag).not.toHaveBeenCalled();
  });

  it('calls onCreateNote when saving a new note with placeholder title', async () => {
    const onCreateNote = vi.fn();
    const onUpdateNote = vi.fn();

    render(
      <ClassicApp
        initialState={createState()}
        onCreateNote={onCreateNote}
        onUpdateNote={onUpdateNote}
      />
    );

    // Create a new note
    fireEvent.contextMenu(
      screen.getByLabelText('Entry list, press Shift+F10 for context menu')
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Create new entry' }));

    // Edit and save the note
    await vi.waitFor(() => {
      expect(screen.getByLabelText('Edit entry title')).toBeInTheDocument();
    });
    const titleInput = screen.getByLabelText('Edit entry title');
    const bodyInput = screen.getByLabelText('Edit entry body');
    fireEvent.change(titleInput, { target: { value: 'My New Note' } });
    fireEvent.change(bodyInput, { target: { value: 'Note content' } });
    fireEvent.click(screen.getByLabelText('Save entry'));

    expect(onCreateNote).toHaveBeenCalledTimes(1);
    expect(onCreateNote.mock.calls[0]?.[2]).toBe('My New Note');
    expect(onCreateNote.mock.calls[0]?.[3]).toBe('Note content');
    expect(onUpdateNote).not.toHaveBeenCalled();
  });

  it('calls onUpdateNote when updating an existing note', async () => {
    const onCreateNote = vi.fn();
    const onUpdateNote = vi.fn();

    render(
      <ClassicApp
        initialState={createState()}
        onCreateNote={onCreateNote}
        onUpdateNote={onUpdateNote}
      />
    );

    // Start editing an existing note
    fireEvent.contextMenu(screen.getByText('Alpha'));
    fireEvent.click(screen.getByLabelText('Edit note Alpha'));

    // Edit and save
    await vi.waitFor(() => {
      expect(screen.getByLabelText('Edit entry title')).toBeInTheDocument();
    });
    const titleInput = screen.getByLabelText('Edit entry title');
    fireEvent.change(titleInput, { target: { value: 'Updated Alpha' } });
    fireEvent.click(screen.getByLabelText('Save entry'));

    expect(onUpdateNote).toHaveBeenCalledWith('note-1', 'Updated Alpha', 'A');
    expect(onCreateNote).not.toHaveBeenCalled();
  });
});

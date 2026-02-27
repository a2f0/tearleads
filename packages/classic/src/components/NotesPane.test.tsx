import { fireEvent, render, screen } from '@testing-library/react';
import { NotesPane } from './NotesPane';

describe('NotesPane', () => {
  it('shows silhouette when no entries exist', () => {
    render(
      <NotesPane
        activeTagName="All Entries"
        noteIds={[]}
        notesById={{}}
        onMoveNote={() => {}}
        onReorderNote={() => {}}
        searchValue=""
        onSearchChange={() => {}}
      />
    );

    // Should show the non-clickable silhouette (no onCreateNote provided)
    expect(
      screen.getByLabelText('Entry list, press Shift+F10 for context menu')
    ).toBeInTheDocument();
  });

  it('renders empty-tag notes state with clickable silhouette', () => {
    const onCreateNote = vi.fn();

    render(
      <NotesPane
        activeTagName="Work"
        noteIds={[]}
        notesById={{}}
        onMoveNote={() => {}}
        onReorderNote={() => {}}
        onCreateNote={onCreateNote}
        searchValue=""
        onSearchChange={() => {}}
      />
    );

    const silhouette = screen.getByLabelText('Create new entry');
    expect(silhouette).toBeInTheDocument();

    fireEvent.click(silhouette);
    expect(onCreateNote).toHaveBeenCalledTimes(1);
  });

  it('renders notes and move controls', () => {
    const onMoveNote = vi.fn();

    render(
      <NotesPane
        activeTagName="Work"
        noteIds={['note-1', 'missing', 'note-2']}
        notesById={{
          'note-1': { id: 'note-1', title: 'Alpha', body: 'A body' },
          'note-2': { id: 'note-2', title: 'Beta', body: 'B body' }
        }}
        onMoveNote={onMoveNote}
        onReorderNote={() => {}}
        searchValue=""
        onSearchChange={() => {}}
      />
    );

    fireEvent.contextMenu(screen.getByText('Beta'));
    fireEvent.click(screen.getByLabelText('Move note Beta up'));
    expect(onMoveNote).toHaveBeenCalledWith('note-2', 'up');

    fireEvent.contextMenu(screen.getByText('Alpha'));
    fireEvent.click(screen.getByLabelText('Move note Alpha down'));
    expect(onMoveNote).toHaveBeenCalledWith('note-1', 'down');

    fireEvent.contextMenu(screen.getByText('Alpha'));
    expect(
      screen.queryByLabelText('Move note Alpha up')
    ).not.toBeInTheDocument();
    fireEvent.contextMenu(screen.getByText('Beta'));
    expect(
      screen.queryByLabelText('Move note Beta down')
    ).not.toBeInTheDocument();
  });

  it('renders left-side drag handles for notes', () => {
    render(
      <NotesPane
        activeTagName="Work"
        noteIds={['note-1', 'note-2']}
        notesById={{
          'note-1': { id: 'note-1', title: 'Alpha', body: 'A body' },
          'note-2': { id: 'note-2', title: 'Beta', body: 'B body' }
        }}
        onMoveNote={() => {}}
        onReorderNote={() => {}}
        searchValue=""
        onSearchChange={() => {}}
      />
    );

    expect(screen.getAllByTitle('Drag entry')).toHaveLength(2);
  });

  it('hides move buttons for single visible note when trailing ids are missing', () => {
    render(
      <NotesPane
        activeTagName="Work"
        noteIds={['note-1', 'missing']}
        notesById={{
          'note-1': { id: 'note-1', title: 'Alpha', body: 'A body' }
        }}
        onMoveNote={() => {}}
        onReorderNote={() => {}}
        searchValue=""
        onSearchChange={() => {}}
      />
    );

    fireEvent.contextMenu(screen.getByText('Alpha'));
    expect(
      screen.queryByLabelText('Move note Alpha up')
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText('Move note Alpha down')
    ).not.toBeInTheDocument();
  });

  it('renders search input and calls onSearchChange', () => {
    const onSearchChange = vi.fn();

    render(
      <NotesPane
        activeTagName="Work"
        noteIds={[]}
        notesById={{}}
        onMoveNote={() => {}}
        onReorderNote={() => {}}
        searchValue="alpha"
        onSearchChange={onSearchChange}
      />
    );

    expect(screen.getByDisplayValue('alpha')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Search entries'), {
      target: { value: 'beta' }
    });

    expect(onSearchChange).toHaveBeenCalledWith('beta');
  });

  it('reorders notes while hovering dragged note over a target', () => {
    const onReorderNote = vi.fn();
    const dataTransfer = {
      effectAllowed: 'move',
      setData: vi.fn(),
      dropEffect: 'none'
    } as unknown as DataTransfer;

    render(
      <NotesPane
        activeTagName="Work"
        noteIds={['note-1', 'note-2']}
        notesById={{
          'note-1': { id: 'note-1', title: 'Alpha', body: 'A body' },
          'note-2': { id: 'note-2', title: 'Beta', body: 'B body' }
        }}
        onMoveNote={() => {}}
        onReorderNote={onReorderNote}
        searchValue=""
        onSearchChange={() => {}}
      />
    );

    const [firstHandle] = screen.getAllByTitle('Drag entry');
    if (!firstHandle) {
      throw new Error('Expected first note drag handle');
    }
    fireEvent.mouseDown(firstHandle);
    fireEvent.dragStart(firstHandle, { dataTransfer });

    const betaItem = screen.getByText('Beta').closest('li');
    if (!betaItem) {
      throw new Error('Expected beta note list item');
    }
    fireEvent.dragOver(betaItem, { dataTransfer });

    expect(onReorderNote).toHaveBeenCalledWith('note-1', 'note-2');
  });

  it('opens empty-space context menu and creates a new entry', () => {
    const onCreateNote = vi.fn();

    render(
      <NotesPane
        activeTagName="Work"
        noteIds={[]}
        notesById={{}}
        onMoveNote={() => {}}
        onReorderNote={() => {}}
        onCreateNote={onCreateNote}
        searchValue=""
        onSearchChange={() => {}}
      />
    );

    fireEvent.contextMenu(
      screen.getByLabelText('Entry list, press Shift+F10 for context menu')
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Create new entry' }));
    expect(onCreateNote).toHaveBeenCalledTimes(1);
  });

  it('calls onTagNote when a tag is dropped on a note', () => {
    const onTagNote = vi.fn();
    const dataTransfer = {
      types: ['application/x-classic-tag'],
      getData: vi.fn().mockReturnValue('tag-1'),
      effectAllowed: 'move',
      setData: vi.fn()
    } as unknown as DataTransfer;

    render(
      <NotesPane
        activeTagName="Work"
        noteIds={['note-1']}
        notesById={{
          'note-1': { id: 'note-1', title: 'Alpha', body: 'A body' }
        }}
        onMoveNote={() => {}}
        onReorderNote={() => {}}
        onTagNote={onTagNote}
        searchValue=""
        onSearchChange={() => {}}
      />
    );

    const noteItem = screen.getByText('Alpha').closest('li');
    if (!noteItem) throw new Error('Expected note list item');

    fireEvent.dragOver(noteItem, { dataTransfer });
    fireEvent.drop(noteItem, { dataTransfer });

    expect(onTagNote).toHaveBeenCalledWith('tag-1', 'note-1');
  });

  it('highlights an entry while it is a valid tag drop target', () => {
    const dataTransfer = {
      types: ['application/x-classic-tag'],
      getData: vi.fn().mockReturnValue('tag-1')
    } as unknown as DataTransfer;

    render(
      <NotesPane
        activeTagName="Work"
        noteIds={['note-1']}
        notesById={{
          'note-1': { id: 'note-1', title: 'Alpha', body: 'A body' }
        }}
        onMoveNote={() => {}}
        onReorderNote={() => {}}
        onTagNote={() => {}}
        searchValue=""
        onSearchChange={() => {}}
      />
    );

    const noteItem = screen.getByText('Alpha').closest('li');
    if (!noteItem) throw new Error('Expected note list item');

    fireEvent.dragEnter(noteItem, { dataTransfer });
    expect(noteItem).toHaveClass('bg-emerald-100');

    fireEvent.dragLeave(noteItem, { dataTransfer });
    expect(noteItem).not.toHaveClass('bg-emerald-100');
  });

  it('highlights and accepts plain-text fallback for tag drops', () => {
    const onTagNote = vi.fn();
    const dataTransfer = {
      types: ['text/plain'],
      getData: vi.fn((key: string) => (key === 'text/plain' ? 'tag-1' : ''))
    } as unknown as DataTransfer;

    render(
      <NotesPane
        activeTagName="Work"
        noteIds={['note-1']}
        notesById={{
          'note-1': { id: 'note-1', title: 'Alpha', body: 'A body' }
        }}
        onMoveNote={() => {}}
        onReorderNote={() => {}}
        onTagNote={onTagNote}
        searchValue=""
        onSearchChange={() => {}}
      />
    );

    const noteItem = screen.getByText('Alpha').closest('li');
    if (!noteItem) throw new Error('Expected note list item');

    fireEvent.dragEnter(noteItem, { dataTransfer });
    expect(noteItem).toHaveClass('bg-emerald-100');

    fireEvent.drop(noteItem, { dataTransfer });
    expect(onTagNote).toHaveBeenCalledWith('tag-1', 'note-1');
  });

  it('shows Save and Cancel buttons when editing an entry', () => {
    render(
      <NotesPane
        activeTagName="Work"
        noteIds={['note-1']}
        notesById={{
          'note-1': { id: 'note-1', title: 'Alpha', body: 'A body' }
        }}
        editingNoteId="note-1"
        onMoveNote={() => {}}
        onReorderNote={() => {}}
        onUpdateNote={() => {}}
        onCancelEditNote={() => {}}
        searchValue=""
        onSearchChange={() => {}}
      />
    );

    expect(screen.getByLabelText('Save entry')).toBeInTheDocument();
    expect(screen.getByLabelText('Cancel editing')).toBeInTheDocument();
  });

  it('calls onUpdateNote when Save button is clicked', () => {
    const onUpdateNote = vi.fn();

    render(
      <NotesPane
        activeTagName="Work"
        noteIds={['note-1']}
        notesById={{
          'note-1': { id: 'note-1', title: 'Alpha', body: 'A body' }
        }}
        editingNoteId="note-1"
        onMoveNote={() => {}}
        onReorderNote={() => {}}
        onUpdateNote={onUpdateNote}
        onCancelEditNote={() => {}}
        searchValue=""
        onSearchChange={() => {}}
      />
    );

    const titleInput = screen.getByLabelText('Edit entry title');
    const bodyInput = screen.getByLabelText('Edit entry body');
    fireEvent.change(titleInput, { target: { value: 'Updated Title' } });
    fireEvent.change(bodyInput, { target: { value: 'Updated Body' } });
    fireEvent.click(screen.getByLabelText('Save entry'));

    expect(onUpdateNote).toHaveBeenCalledWith(
      'note-1',
      'Updated Title',
      'Updated Body'
    );
  });

  it('calls onCancelEditNote when Cancel button is clicked', () => {
    const onCancelEditNote = vi.fn();

    render(
      <NotesPane
        activeTagName="Work"
        noteIds={['note-1']}
        notesById={{
          'note-1': { id: 'note-1', title: 'Alpha', body: 'A body' }
        }}
        editingNoteId="note-1"
        onMoveNote={() => {}}
        onReorderNote={() => {}}
        onUpdateNote={() => {}}
        onCancelEditNote={onCancelEditNote}
        searchValue=""
        onSearchChange={() => {}}
      />
    );

    fireEvent.click(screen.getByLabelText('Cancel editing'));

    expect(onCancelEditNote).toHaveBeenCalledTimes(1);
  });
});

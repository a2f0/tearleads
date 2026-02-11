import { fireEvent, render, screen } from '@testing-library/react';
import { NotesPane } from './NotesPane';

describe('NotesPane', () => {
  it('asks user to select a tag when none is active', () => {
    render(
      <NotesPane
        activeTagName={null}
        noteIds={[]}
        notesById={{}}
        onMoveNote={() => {}}
        onReorderNote={() => {}}
        searchValue=""
        onSearchChange={() => {}}
      />
    );

    expect(screen.getByText('Select a tag to view notes.')).toBeInTheDocument();
  });

  it('renders empty-tag notes state', () => {
    render(
      <NotesPane
        activeTagName="Work"
        noteIds={[]}
        notesById={{}}
        onMoveNote={() => {}}
        onReorderNote={() => {}}
        searchValue=""
        onSearchChange={() => {}}
      />
    );

    expect(screen.getByText('No entries in this tag.')).toBeInTheDocument();
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
    expect(dataTransfer.dropEffect).toBe('move');
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

    fireEvent.contextMenu(screen.getByText('No entries in this tag.'));
    fireEvent.click(screen.getByLabelText('Create new entry'));
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
});

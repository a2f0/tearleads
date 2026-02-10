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
    expect(screen.getByLabelText('Move note Alpha up')).toBeDisabled();
    fireEvent.contextMenu(screen.getByText('Beta'));
    expect(screen.getByLabelText('Move note Beta down')).toBeDisabled();
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

  it('disables down for last visible note when trailing ids are missing', () => {
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
    expect(screen.getByLabelText('Move note Alpha down')).toBeDisabled();
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
      setData: vi.fn()
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
    fireEvent.dragOver(betaItem);

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

    fireEvent.contextMenu(screen.getByText('No entries in this tag.'));
    fireEvent.click(screen.getByLabelText('Create new entry'));
    expect(onCreateNote).toHaveBeenCalledTimes(1);
  });
});

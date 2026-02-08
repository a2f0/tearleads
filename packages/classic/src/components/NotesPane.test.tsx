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
        searchValue=""
        onSearchChange={() => {}}
      />
    );

    expect(screen.getByText('No notes in this tag.')).toBeInTheDocument();
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

  it('renders note handle controls and emits move events', () => {
    const onMoveNote = vi.fn();

    render(
      <NotesPane
        activeTagName="Work"
        noteIds={['note-1', 'note-2']}
        notesById={{
          'note-1': { id: 'note-1', title: 'Alpha', body: 'A body' },
          'note-2': { id: 'note-2', title: 'Beta', body: 'B body' }
        }}
        onMoveNote={onMoveNote}
        searchValue=""
        onSearchChange={() => {}}
      />
    );

    fireEvent.click(screen.getByLabelText('Move note Alpha down via handle'));
    expect(onMoveNote).toHaveBeenCalledWith('note-1', 'down');

    fireEvent.click(screen.getByLabelText('Move note Beta up via handle'));
    expect(onMoveNote).toHaveBeenCalledWith('note-2', 'up');

    expect(
      screen.getByLabelText('Move note Alpha up via handle')
    ).toBeDisabled();
    expect(
      screen.getByLabelText('Move note Beta down via handle')
    ).toBeDisabled();
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
        searchValue="alpha"
        onSearchChange={onSearchChange}
      />
    );

    expect(screen.getByDisplayValue('alpha')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Search entries...'), {
      target: { value: 'beta' }
    });

    expect(onSearchChange).toHaveBeenCalledWith('beta');
  });
});

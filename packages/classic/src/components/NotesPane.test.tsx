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
      />
    );

    fireEvent.click(screen.getByLabelText('Move note Beta up'));
    expect(onMoveNote).toHaveBeenCalledWith('note-2', 'up');

    fireEvent.click(screen.getByLabelText('Move note Alpha down'));
    expect(onMoveNote).toHaveBeenCalledWith('note-1', 'down');

    expect(screen.getByLabelText('Move note Alpha up')).toBeDisabled();
    expect(screen.getByLabelText('Move note Beta down')).toBeDisabled();
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
      />
    );

    expect(screen.getByLabelText('Move note Alpha down')).toBeDisabled();
  });
});

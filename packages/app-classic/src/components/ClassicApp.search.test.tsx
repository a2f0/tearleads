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

describe('ClassicApp - Search and filtering', () => {
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

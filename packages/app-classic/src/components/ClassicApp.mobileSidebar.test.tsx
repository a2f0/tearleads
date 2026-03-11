import { act, fireEvent, render, screen } from '@testing-library/react';
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
      'note-2': { id: 'note-2', title: 'Beta', body: 'B' }
    },
    noteOrderByTagId: {
      'tag-1': ['note-1'],
      'tag-2': ['note-2']
    },
    activeTagId
  };
}

function setViewportWidth(width: number) {
  act(() => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: width
    });
    window.dispatchEvent(new Event('resize'));
  });
}

describe('ClassicApp mobile sidebar', () => {
  afterEach(() => {
    setViewportWidth(1024);
  });

  it('shows a hamburger toggle and opens the sidebar drawer on mobile', () => {
    setViewportWidth(375);

    render(<ClassicApp initialState={createState()} />);

    const toggle = screen.getByTestId('window-sidebar-toggle');
    expect(toggle).toBeInTheDocument();

    act(() => {
      fireEvent.click(toggle);
    });

    expect(
      screen.getByTestId('classic-tags-sidebar-drawer')
    ).toBeInTheDocument();
  });

  it('closes the mobile drawer after selecting a tag', () => {
    vi.useFakeTimers();
    setViewportWidth(375);

    try {
      render(<ClassicApp initialState={createState()} />);
      act(() => {
        fireEvent.click(screen.getByTestId('window-sidebar-toggle'));
      });
      act(() => {
        fireEvent.click(screen.getByLabelText('Select tag Personal'));
      });

      act(() => {
        vi.advanceTimersByTime(350);
      });

      expect(
        screen.queryByTestId('classic-tags-sidebar-drawer')
      ).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

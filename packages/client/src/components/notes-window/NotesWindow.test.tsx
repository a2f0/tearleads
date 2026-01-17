import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotesWindow } from './NotesWindow';

// Mock FloatingWindow
vi.mock('@/components/floating-window', () => ({
  FloatingWindow: ({
    children,
    title,
    onClose
  }: {
    children: React.ReactNode;
    title: string;
    onClose: () => void;
  }) => (
    <div data-testid="floating-window">
      <div data-testid="window-title">{title}</div>
      <button type="button" onClick={onClose} data-testid="close-window">
        Close
      </button>
      {children}
    </div>
  )
}));

// Mock NotesWindowList
vi.mock('./NotesWindowList', () => ({
  NotesWindowList: ({
    onSelectNote
  }: {
    onSelectNote: (id: string) => void;
  }) => (
    <div data-testid="notes-list">
      <button
        type="button"
        onClick={() => onSelectNote('note-123')}
        data-testid="select-note"
      >
        Select Note
      </button>
    </div>
  )
}));

// Mock NotesWindowDetail
vi.mock('./NotesWindowDetail', () => ({
  NotesWindowDetail: ({
    noteId,
    onBack,
    onDeleted
  }: {
    noteId: string;
    onBack: () => void;
    onDeleted: () => void;
  }) => (
    <div data-testid="notes-detail">
      <span data-testid="detail-note-id">{noteId}</span>
      <button type="button" onClick={onBack} data-testid="back-button">
        Back
      </button>
      <button type="button" onClick={onDeleted} data-testid="delete-button">
        Delete
      </button>
    </div>
  )
}));

describe('NotesWindow', () => {
  const defaultProps = {
    id: 'test-window',
    onClose: vi.fn(),
    onFocus: vi.fn(),
    zIndex: 100
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders in FloatingWindow', () => {
    render(<NotesWindow {...defaultProps} />);
    expect(screen.getByTestId('floating-window')).toBeInTheDocument();
  });

  it('shows list view by default', () => {
    render(<NotesWindow {...defaultProps} />);
    expect(screen.getByTestId('notes-list')).toBeInTheDocument();
    expect(screen.queryByTestId('notes-detail')).not.toBeInTheDocument();
  });

  it('switches to detail view when note is selected', async () => {
    const user = userEvent.setup();
    render(<NotesWindow {...defaultProps} />);

    await user.click(screen.getByTestId('select-note'));

    await waitFor(() => {
      expect(screen.getByTestId('notes-detail')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('notes-list')).not.toBeInTheDocument();
  });

  it('passes correct noteId to detail view', async () => {
    const user = userEvent.setup();
    render(<NotesWindow {...defaultProps} />);

    await user.click(screen.getByTestId('select-note'));

    await waitFor(() => {
      expect(screen.getByTestId('detail-note-id')).toHaveTextContent(
        'note-123'
      );
    });
  });

  it('returns to list view when back is clicked', async () => {
    const user = userEvent.setup();
    render(<NotesWindow {...defaultProps} />);

    // Go to detail view
    await user.click(screen.getByTestId('select-note'));
    await waitFor(() => {
      expect(screen.getByTestId('notes-detail')).toBeInTheDocument();
    });

    // Go back
    await user.click(screen.getByTestId('back-button'));
    await waitFor(() => {
      expect(screen.getByTestId('notes-list')).toBeInTheDocument();
    });
  });

  it('returns to list view when note is deleted', async () => {
    const user = userEvent.setup();
    render(<NotesWindow {...defaultProps} />);

    // Go to detail view
    await user.click(screen.getByTestId('select-note'));
    await waitFor(() => {
      expect(screen.getByTestId('notes-detail')).toBeInTheDocument();
    });

    // Delete note
    await user.click(screen.getByTestId('delete-button'));
    await waitFor(() => {
      expect(screen.getByTestId('notes-list')).toBeInTheDocument();
    });
  });

  it('calls onClose when close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<NotesWindow {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByTestId('close-window'));
    expect(onClose).toHaveBeenCalled();
  });

  it('updates title based on view', async () => {
    const user = userEvent.setup();
    render(<NotesWindow {...defaultProps} />);

    // List view shows "Notes"
    expect(screen.getByTestId('window-title')).toHaveTextContent('Notes');

    // Go to detail view
    await user.click(screen.getByTestId('select-note'));

    // Detail view shows "Note"
    await waitFor(() => {
      expect(screen.getByTestId('window-title')).toHaveTextContent('Note');
    });
  });
});

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotesWindow } from './NotesWindow';

const mockInsert = vi.fn().mockReturnValue({
  values: vi.fn().mockResolvedValue(undefined)
});

// Mock database
vi.mock('@/db', () => ({
  getDatabase: () => ({
    insert: mockInsert
  })
}));

// Mock database hooks
vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => ({
    isUnlocked: true,
    isLoading: false,
    currentInstanceId: 'test-instance'
  })
}));

// Mock database schema
vi.mock('@/db/schema', () => ({
  notes: {}
}));

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
    showDeleted: boolean;
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

// Mock NotesWindowMenuBar
vi.mock('./NotesWindowMenuBar', () => ({
  NotesWindowMenuBar: ({
    onNewNote,
    onViewModeChange,
    onToggleMarkdownToolbar
  }: {
    onNewNote: () => void;
    onViewModeChange: (mode: 'list' | 'table') => void;
    onToggleMarkdownToolbar: () => void;
    showMarkdownToolbarOption: boolean;
    showMarkdownToolbar: boolean;
    showListTableOptions: boolean;
    showDeleted: boolean;
    onShowDeletedChange: (show: boolean) => void;
  }) => (
    <div data-testid="menu-bar">
      <button type="button" onClick={onNewNote} data-testid="new-note-button">
        New Note
      </button>
      <button
        type="button"
        onClick={() => onViewModeChange('table')}
        data-testid="table-view-button"
      >
        Table View
      </button>
      <button
        type="button"
        onClick={onToggleMarkdownToolbar}
        data-testid="toggle-toolbar-button"
      >
        Toggle Toolbar
      </button>
    </div>
  )
}));

// Mock NotesWindowTableView
vi.mock('./NotesWindowTableView', () => ({
  NotesWindowTableView: ({
    showDeleted
  }: {
    showDeleted: boolean;
  }) => <div data-testid="notes-table" data-show-deleted={showDeleted} />
}));

describe('NotesWindow', () => {
  const defaultProps = {
    id: 'test-window',
    onClose: vi.fn(),
    onMinimize: vi.fn(),
    onFocus: vi.fn(),
    zIndex: 100
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockInsert.mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined)
    });
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

  it('keeps menu bar visible in detail view', async () => {
    const user = userEvent.setup();
    render(<NotesWindow {...defaultProps} />);

    await user.click(screen.getByTestId('select-note'));

    await waitFor(() => {
      expect(screen.getByTestId('notes-detail')).toBeInTheDocument();
    });
    expect(screen.getByTestId('menu-bar')).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <NotesWindow {...defaultProps} onClose={onClose} onMinimize={vi.fn()} />
    );

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

  it('creates new note when new note button is clicked', async () => {
    const user = userEvent.setup();
    render(<NotesWindow {...defaultProps} />);

    await user.click(screen.getByTestId('new-note-button'));

    await waitFor(() => {
      expect(mockInsert).toHaveBeenCalled();
    });

    // Should switch to detail view
    await waitFor(() => {
      expect(screen.getByTestId('notes-detail')).toBeInTheDocument();
    });
  });

  it('handles new note creation error gracefully', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    mockInsert.mockReturnValueOnce({
      values: vi.fn().mockRejectedValueOnce(new Error('Database error'))
    });

    const user = userEvent.setup();
    render(<NotesWindow {...defaultProps} />);

    await user.click(screen.getByTestId('new-note-button'));

    await waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith(
        'Failed to create note:',
        expect.any(Error)
      );
    });

    consoleError.mockRestore();
  });

  it('switches to table view when table view button is clicked', async () => {
    const user = userEvent.setup();
    render(<NotesWindow {...defaultProps} />);

    await user.click(screen.getByTestId('table-view-button'));

    await waitFor(() => {
      expect(screen.getByTestId('notes-table')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('notes-list')).not.toBeInTheDocument();
  });
});

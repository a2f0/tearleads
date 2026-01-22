import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockConsoleError } from '@/test/console-mocks';
import { NotesWindowTableView } from './NotesWindowTableView';

// Create mutable mock state
const mockDatabaseState = {
  isUnlocked: true,
  isLoading: false,
  currentInstanceId: 'test-instance'
};

// Mock database hooks
vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => mockDatabaseState
}));

// Mock i18n
vi.mock('@/i18n', () => ({
  useTypedTranslation: () => ({
    t: (key: string) =>
      ({
        getInfo: 'Get Info',
        delete: 'Delete',
        newNote: 'New Note'
      })[key] ?? key
  })
}));

// Mock InlineUnlock
vi.mock('@/components/sqlite/InlineUnlock', () => ({
  InlineUnlock: ({ description }: { description: string }) => (
    <div data-testid="inline-unlock">Unlock for {description}</div>
  )
}));

// Mock notes data
const mockNotes = [
  {
    id: 'note-1',
    title: 'Alpha Note',
    content: 'Content A',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-05'),
    deleted: false
  },
  {
    id: 'note-2',
    title: 'Beta Note',
    content: 'Content B',
    createdAt: new Date('2024-01-02'),
    updatedAt: new Date('2024-01-03'),
    deleted: false
  }
];

// Mock getDatabase with a complete chain
const mockDb = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockResolvedValue([]),
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockResolvedValue(undefined),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis()
};

vi.mock('@/db', () => ({
  getDatabase: () => mockDb
}));

describe('NotesWindowTableView', () => {
  const defaultProps = {
    onSelectNote: vi.fn(),
    showDeleted: false
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDatabaseState.isUnlocked = true;
    mockDatabaseState.isLoading = false;
    mockDb.orderBy.mockResolvedValue([]);
    mockDb.set.mockReturnThis();
    mockDb.where.mockReturnThis();
  });

  it('shows database loading state', () => {
    mockDatabaseState.isLoading = true;
    mockDatabaseState.isUnlocked = false;
    render(<NotesWindowTableView {...defaultProps} />);
    expect(screen.getByText('Loading database...')).toBeInTheDocument();
  });

  it('shows unlock prompt when database is locked', () => {
    mockDatabaseState.isUnlocked = false;
    mockDatabaseState.isLoading = false;
    render(<NotesWindowTableView {...defaultProps} />);
    expect(screen.getByTestId('inline-unlock')).toBeInTheDocument();
  });

  it('renders header with Notes title', () => {
    render(<NotesWindowTableView {...defaultProps} />);
    expect(screen.getByText('Notes')).toBeInTheDocument();
  });

  it('renders create note button when unlocked', () => {
    render(<NotesWindowTableView {...defaultProps} />);
    expect(screen.getByTestId('table-create-note-button')).toBeInTheDocument();
  });

  it('shows empty state when no notes exist', async () => {
    mockDb.orderBy.mockResolvedValue([]);
    render(<NotesWindowTableView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('No notes yet')).toBeInTheDocument();
    });
    expect(screen.getByTestId('table-empty-create-note')).toBeInTheDocument();
  });

  it('renders table with notes when notes exist', async () => {
    mockDb.orderBy.mockResolvedValue(mockNotes);
    render(<NotesWindowTableView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Alpha Note')).toBeInTheDocument();
    });
    expect(screen.getByText('Beta Note')).toBeInTheDocument();
  });

  it('renders deleted notes when showDeleted is true', async () => {
    const deletedNotes = [
      {
        ...mockNotes[0],
        id: 'note-deleted',
        title: 'Deleted Note',
        deleted: true
      }
    ];
    mockDb.orderBy.mockResolvedValue(deletedNotes);
    const onSelectNote = vi.fn();
    const user = userEvent.setup();
    render(
      <NotesWindowTableView onSelectNote={onSelectNote} showDeleted={true} />
    );

    await waitFor(() => {
      expect(screen.getByText('Deleted Note')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Deleted Note'));
    expect(onSelectNote).not.toHaveBeenCalled();
  });

  it('renders sortable column headers', async () => {
    mockDb.orderBy.mockResolvedValue(mockNotes);
    render(<NotesWindowTableView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Alpha Note')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: /Title/i })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Created/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Updated/i })
    ).toBeInTheDocument();
  });

  it('calls onSelectNote when a row is clicked', async () => {
    mockDb.orderBy.mockResolvedValue(mockNotes);
    const onSelectNote = vi.fn();
    const user = userEvent.setup();
    render(
      <NotesWindowTableView onSelectNote={onSelectNote} showDeleted={false} />
    );

    await waitFor(() => {
      expect(screen.getByText('Alpha Note')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Alpha Note'));
    expect(onSelectNote).toHaveBeenCalledWith('note-1');
  });

  it('creates new note when create button is clicked', async () => {
    mockDb.orderBy.mockResolvedValue([]);
    const onSelectNote = vi.fn();
    const user = userEvent.setup();
    render(
      <NotesWindowTableView onSelectNote={onSelectNote} showDeleted={false} />
    );

    await waitFor(() => {
      expect(screen.getByTestId('table-empty-create-note')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('table-empty-create-note'));

    expect(mockDb.insert).toHaveBeenCalled();
    expect(onSelectNote).toHaveBeenCalled();
  });

  it('shows error state when fetch fails', async () => {
    mockDb.orderBy.mockRejectedValue(new Error('Database error'));
    const consoleSpy = mockConsoleError();
    render(<NotesWindowTableView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Database error')).toBeInTheDocument();
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to fetch notes:',
      expect.any(Error)
    );
  });

  it('does not fetch when database is locked', () => {
    mockDatabaseState.isUnlocked = false;
    render(<NotesWindowTableView {...defaultProps} />);
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it('changes sort when column header is clicked', async () => {
    mockDb.orderBy.mockResolvedValue(mockNotes);
    const user = userEvent.setup();
    render(<NotesWindowTableView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Alpha Note')).toBeInTheDocument();
    });

    vi.clearAllMocks();
    mockDb.orderBy.mockResolvedValue(mockNotes);

    await user.click(screen.getByRole('button', { name: /Title/i }));

    await waitFor(() => {
      expect(mockDb.select).toHaveBeenCalled();
    });
  });

  it('toggles sort direction when same column is clicked twice', async () => {
    mockDb.orderBy.mockResolvedValue(mockNotes);
    const user = userEvent.setup();
    render(<NotesWindowTableView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Alpha Note')).toBeInTheDocument();
    });

    // Click Title to sort by title ascending
    await user.click(screen.getByRole('button', { name: /Title/i }));

    await waitFor(() => {
      // Should show ascending indicator
      expect(
        screen.getByRole('button', { name: /Title/i }).querySelector('svg')
      ).toBeInTheDocument();
    });

    vi.clearAllMocks();
    mockDb.orderBy.mockResolvedValue(mockNotes);

    // Click again to toggle to descending
    await user.click(screen.getByRole('button', { name: /Title/i }));

    await waitFor(() => {
      expect(mockDb.select).toHaveBeenCalled();
    });
  });

  it('shows New Note menu when right-clicking blank space', async () => {
    mockDb.orderBy.mockResolvedValue(mockNotes);
    const user = userEvent.setup();
    render(<NotesWindowTableView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Alpha Note')).toBeInTheDocument();
    });

    // Find the table container and right-click it
    const tableContainer = screen.getByRole('table').parentElement;
    expect(tableContainer).toBeInTheDocument();

    if (tableContainer) {
      await user.pointer({ keys: '[MouseRight]', target: tableContainer });
    }

    expect(screen.getByText('New Note')).toBeInTheDocument();
  });

  it('creates note when clicking New Note from blank space menu', async () => {
    mockDb.orderBy.mockResolvedValue(mockNotes);
    const onSelectNote = vi.fn();
    const user = userEvent.setup();
    render(
      <NotesWindowTableView onSelectNote={onSelectNote} showDeleted={false} />
    );

    await waitFor(() => {
      expect(screen.getByText('Alpha Note')).toBeInTheDocument();
    });

    const tableContainer = screen.getByRole('table').parentElement;

    if (tableContainer) {
      await user.pointer({ keys: '[MouseRight]', target: tableContainer });
    }

    expect(screen.getByText('New Note')).toBeInTheDocument();
    await user.click(screen.getByText('New Note'));

    expect(mockDb.insert).toHaveBeenCalled();
    expect(onSelectNote).toHaveBeenCalled();
  });

  it('shows note-specific menu when right-clicking on a table row', async () => {
    mockDb.orderBy.mockResolvedValue(mockNotes);
    const user = userEvent.setup();
    render(<NotesWindowTableView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Alpha Note')).toBeInTheDocument();
    });

    // Right-click on a table row
    const noteRow = screen.getByText('Alpha Note').closest('tr');
    expect(noteRow).toBeInTheDocument();

    if (noteRow) {
      await user.pointer({ keys: '[MouseRight]', target: noteRow });
    }

    // Should show note menu, not blank space menu
    expect(screen.getByText('Get Info')).toBeInTheDocument();
    expect(screen.getByText('Delete')).toBeInTheDocument();
    expect(screen.queryByText('New Note')).not.toBeInTheDocument();
  });

  it('calls onSelectNote when Get Info is clicked from context menu', async () => {
    mockDb.orderBy.mockResolvedValue(mockNotes);
    const onSelectNote = vi.fn();
    const user = userEvent.setup();
    render(
      <NotesWindowTableView onSelectNote={onSelectNote} showDeleted={false} />
    );

    await waitFor(() => {
      expect(screen.getByText('Alpha Note')).toBeInTheDocument();
    });

    const noteRow = screen.getByText('Alpha Note').closest('tr');
    if (noteRow) {
      await user.pointer({ keys: '[MouseRight]', target: noteRow });
    }

    await waitFor(() => {
      expect(screen.getByText('Get Info')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Get Info'));
    expect(onSelectNote).toHaveBeenCalledWith('note-1');
  });

  it('deletes note via context menu', async () => {
    mockDb.orderBy.mockResolvedValue(mockNotes);
    mockDb.set.mockReturnThis();
    mockDb.where.mockReturnThis();
    const user = userEvent.setup();
    render(<NotesWindowTableView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Alpha Note')).toBeInTheDocument();
    });

    const noteRow = screen.getByText('Alpha Note').closest('tr');
    if (noteRow) {
      await user.pointer({ keys: '[MouseRight]', target: noteRow });
    }

    await waitFor(() => {
      expect(screen.getByText('Delete')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Delete'));

    await waitFor(() => {
      expect(mockDb.update).toHaveBeenCalled();
    });
  });

  it('handles delete error gracefully', async () => {
    mockDb.orderBy.mockResolvedValue(mockNotes);
    const consoleSpy = mockConsoleError();
    const user = userEvent.setup();
    render(<NotesWindowTableView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Alpha Note')).toBeInTheDocument();
    });

    const noteRow = screen.getByText('Alpha Note').closest('tr');
    if (noteRow) {
      await user.pointer({ keys: '[MouseRight]', target: noteRow });
    }

    await waitFor(() => {
      expect(screen.getByText('Delete')).toBeInTheDocument();
    });

    mockDb.set.mockReturnThis();
    mockDb.where.mockRejectedValueOnce(new Error('Delete failed'));

    await user.click(screen.getByText('Delete'));

    await waitFor(() => {
      expect(screen.getByText('Delete failed')).toBeInTheDocument();
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to delete note:',
      expect.any(Error)
    );
  });
});

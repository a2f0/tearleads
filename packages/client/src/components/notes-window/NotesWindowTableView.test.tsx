import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
        delete: 'Delete'
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
    updatedAt: new Date('2024-01-05')
  },
  {
    id: 'note-2',
    title: 'Beta Note',
    content: 'Content B',
    createdAt: new Date('2024-01-02'),
    updatedAt: new Date('2024-01-03')
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
    onSelectNote: vi.fn()
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
    render(<NotesWindowTableView onSelectNote={onSelectNote} />);

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
    render(<NotesWindowTableView onSelectNote={onSelectNote} />);

    await waitFor(() => {
      expect(screen.getByTestId('table-empty-create-note')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('table-empty-create-note'));

    expect(mockDb.insert).toHaveBeenCalled();
    expect(onSelectNote).toHaveBeenCalled();
  });

  it('shows error state when fetch fails', async () => {
    mockDb.orderBy.mockRejectedValue(new Error('Database error'));
    render(<NotesWindowTableView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Database error')).toBeInTheDocument();
    });
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
});

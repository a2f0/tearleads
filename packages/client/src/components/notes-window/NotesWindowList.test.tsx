import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotesWindowList } from './NotesWindowList';

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
    title: 'First Note',
    content: '# Hello World\nThis is content',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-02')
  },
  {
    id: 'note-2',
    title: 'Second Note',
    content: 'Short content',
    createdAt: new Date('2024-01-01'),
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

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn()
  }
}));

// Mock useVirtualizer
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, i) => ({
        index: i,
        start: i * 56,
        size: 56,
        key: i
      })),
    getTotalSize: () => count * 56,
    measureElement: vi.fn()
  })
}));

describe('NotesWindowList', () => {
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
    render(<NotesWindowList {...defaultProps} />);
    expect(screen.getByText('Loading database...')).toBeInTheDocument();
  });

  it('shows unlock prompt when database is locked', () => {
    mockDatabaseState.isUnlocked = false;
    mockDatabaseState.isLoading = false;
    render(<NotesWindowList {...defaultProps} />);
    expect(screen.getByTestId('inline-unlock')).toBeInTheDocument();
  });

  it('renders container element', () => {
    const { container } = render(<NotesWindowList {...defaultProps} />);
    expect(container.firstChild).toBeInTheDocument();
  });

  it('renders header with Notes title', () => {
    render(<NotesWindowList {...defaultProps} />);
    expect(screen.getByText('Notes')).toBeInTheDocument();
  });

  it('renders create note button when unlocked', () => {
    render(<NotesWindowList {...defaultProps} />);
    expect(screen.getByTestId('window-create-note-button')).toBeInTheDocument();
  });

  it('renders refresh button when unlocked', () => {
    render(<NotesWindowList {...defaultProps} />);
    expect(
      screen.getByRole('button', { name: /refresh/i })
    ).toBeInTheDocument();
  });

  it('shows empty state when no notes exist', async () => {
    mockDb.orderBy.mockResolvedValue([]);
    render(<NotesWindowList {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('No notes yet')).toBeInTheDocument();
    });
    expect(screen.getByTestId('window-empty-create-note')).toBeInTheDocument();
  });

  it('renders notes list when notes exist', async () => {
    mockDb.orderBy.mockResolvedValue(mockNotes);
    render(<NotesWindowList {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('First Note')).toBeInTheDocument();
    });
    expect(screen.getByText('Second Note')).toBeInTheDocument();
  });

  it('renders search input when notes exist', async () => {
    mockDb.orderBy.mockResolvedValue(mockNotes);
    render(<NotesWindowList {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByTestId('window-notes-search')).toBeInTheDocument();
    });
  });

  it('filters notes by search query', async () => {
    mockDb.orderBy.mockResolvedValue(mockNotes);
    const user = userEvent.setup();
    render(<NotesWindowList {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('First Note')).toBeInTheDocument();
    });

    const searchInput = screen.getByTestId('window-notes-search');
    await user.type(searchInput, 'Second');

    expect(screen.queryByText('First Note')).not.toBeInTheDocument();
    expect(screen.getByText('Second Note')).toBeInTheDocument();
  });

  it('calls onSelectNote when note is clicked', async () => {
    mockDb.orderBy.mockResolvedValue(mockNotes);
    const onSelectNote = vi.fn();
    const user = userEvent.setup();
    render(<NotesWindowList onSelectNote={onSelectNote} />);

    await waitFor(() => {
      expect(screen.getByText('First Note')).toBeInTheDocument();
    });

    await user.click(screen.getByText('First Note'));
    expect(onSelectNote).toHaveBeenCalledWith('note-1');
  });

  it('renders note list items with expected structure', async () => {
    mockDb.orderBy.mockResolvedValue(mockNotes);
    render(<NotesWindowList {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('First Note')).toBeInTheDocument();
    });

    // Verify note titles are rendered as buttons
    const noteElement = screen.getByText('First Note').closest('button');
    expect(noteElement).toBeInTheDocument();
  });

  it('creates new note when create button is clicked', async () => {
    mockDb.orderBy.mockResolvedValue([]);
    const onSelectNote = vi.fn();
    const user = userEvent.setup();
    render(<NotesWindowList onSelectNote={onSelectNote} />);

    await waitFor(() => {
      expect(
        screen.getByTestId('window-empty-create-note')
      ).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('window-empty-create-note'));

    expect(mockDb.insert).toHaveBeenCalled();
    expect(onSelectNote).toHaveBeenCalled();
  });

  it('shows error state when fetch fails', async () => {
    mockDb.orderBy.mockRejectedValue(new Error('Database error'));
    render(<NotesWindowList {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Database error')).toBeInTheDocument();
    });
  });

  it('truncates long content in preview', async () => {
    const longContent = 'A'.repeat(150);
    mockDb.orderBy.mockResolvedValue([
      {
        ...mockNotes[0],
        content: longContent
      }
    ]);
    render(<NotesWindowList {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('First Note')).toBeInTheDocument();
    });
    // Should show truncated content with ellipsis
    expect(screen.getByText(/A{100}\.\.\./)).toBeInTheDocument();
  });

  it('shows "No content" for empty note content', async () => {
    mockDb.orderBy.mockResolvedValue([
      {
        ...mockNotes[0],
        content: ''
      }
    ]);
    render(<NotesWindowList {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('First Note')).toBeInTheDocument();
    });
    expect(screen.getByText(/No content/)).toBeInTheDocument();
  });

  it('does not render action buttons when database is locked', () => {
    mockDatabaseState.isUnlocked = false;
    render(<NotesWindowList {...defaultProps} />);

    expect(
      screen.queryByTestId('window-create-note-button')
    ).not.toBeInTheDocument();
  });

  it('refreshes notes when refresh button is clicked', async () => {
    mockDb.orderBy.mockResolvedValue(mockNotes);
    const user = userEvent.setup();
    render(<NotesWindowList {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('First Note')).toBeInTheDocument();
    });

    vi.clearAllMocks();
    mockDb.orderBy.mockResolvedValue(mockNotes);

    await user.click(screen.getByRole('button', { name: /refresh/i }));

    await waitFor(() => {
      expect(mockDb.select).toHaveBeenCalled();
    });
  });

  it('does not fetch when database is locked', () => {
    mockDatabaseState.isUnlocked = false;
    render(<NotesWindowList {...defaultProps} />);

    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it('shows error when create note fails from header button', async () => {
    mockDb.orderBy.mockResolvedValue(mockNotes);
    mockDb.values.mockRejectedValue(new Error('Create failed'));
    const user = userEvent.setup();
    render(<NotesWindowList {...defaultProps} />);

    await waitFor(() => {
      expect(
        screen.getByTestId('window-create-note-button')
      ).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('window-create-note-button'));

    await waitFor(() => {
      expect(screen.getByText('Create failed')).toBeInTheDocument();
    });
  });

  it('displays content preview for notes', async () => {
    mockDb.orderBy.mockResolvedValue(mockNotes);
    render(<NotesWindowList {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('First Note')).toBeInTheDocument();
    });

    // The content preview should show the content without markdown symbols
    expect(screen.getByText(/Hello World/)).toBeInTheDocument();
  });

  it('renders search input with placeholder', async () => {
    mockDb.orderBy.mockResolvedValue(mockNotes);
    render(<NotesWindowList {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByTestId('window-notes-search')).toBeInTheDocument();
    });

    expect(screen.getByPlaceholderText('Search notes...')).toBeInTheDocument();
  });

  it('shows formatted date for notes', async () => {
    mockDb.orderBy.mockResolvedValue(mockNotes);
    render(<NotesWindowList {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('First Note')).toBeInTheDocument();
    });

    // Date should be formatted and visible - multiple notes have January dates
    const dateElements = screen.getAllByText(/January/);
    expect(dateElements.length).toBeGreaterThan(0);
  });

  it('handles search query clearing', async () => {
    mockDb.orderBy.mockResolvedValue(mockNotes);
    const user = userEvent.setup();
    render(<NotesWindowList {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('First Note')).toBeInTheDocument();
    });

    const searchInput = screen.getByTestId('window-notes-search');
    await user.type(searchInput, 'Second');

    expect(screen.queryByText('First Note')).not.toBeInTheDocument();
    expect(screen.getByText('Second Note')).toBeInTheDocument();

    // Clear the search
    await user.clear(searchInput);

    await waitFor(() => {
      expect(screen.getByText('First Note')).toBeInTheDocument();
      expect(screen.getByText('Second Note')).toBeInTheDocument();
    });
  });
});

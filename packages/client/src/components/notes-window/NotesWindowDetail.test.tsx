import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotesWindowDetail } from './NotesWindowDetail';

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

// Mock ThemeProvider - use partial mock to keep other exports working
vi.mock('@rapid/ui', async () => {
  const actual = await vi.importActual('@rapid/ui');
  return {
    ...actual,
    useTheme: () => ({ resolvedTheme: 'light' })
  };
});

// Mock note data
const mockNote = {
  id: 'note-1',
  title: 'Test Note',
  content: '# Hello World',
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-02')
};

// Create mock results - use a pending promise by default to avoid async state updates after test
const pendingPromise = new Promise(() => {});
let limitResult: unknown = pendingPromise;
let updateError: Error | null = null;
let shouldResolve = false;

// Mock getDatabase with proper Drizzle-style chaining
vi.mock('@/db', () => ({
  getDatabase: () => {
    const chainable = {
      select: vi.fn(() => chainable),
      from: vi.fn(() => chainable),
      where: vi.fn(() => {
        if (updateError) {
          return Promise.reject(updateError);
        }
        return chainable;
      }),
      limit: vi.fn(() => {
        if (shouldResolve) {
          return Promise.resolve(limitResult);
        }
        return pendingPromise;
      }),
      update: vi.fn(() => chainable),
      set: vi.fn(() => chainable),
      catch: vi.fn(() => Promise.resolve())
    };
    return chainable;
  }
}));

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn()
  }
}));

// Mock MDEditor
vi.mock('@uiw/react-md-editor', () => ({
  default: ({
    value,
    onChange
  }: {
    value: string;
    onChange: (val: string) => void;
  }) => (
    <textarea
      data-testid="md-editor"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}));

// Mock InlineUnlock
vi.mock('@/components/sqlite/InlineUnlock', () => ({
  InlineUnlock: ({ description }: { description: string }) => (
    <div data-testid="inline-unlock">Unlock for {description}</div>
  )
}));

// Mock EditableTitle
vi.mock('@/components/ui/editable-title', () => ({
  EditableTitle: ({
    value,
    onSave,
    'data-testid': testId
  }: {
    value: string;
    onSave: (val: string) => void;
    'data-testid'?: string;
  }) => (
    <input
      data-testid={testId || 'editable-title'}
      value={value}
      onChange={(e) => onSave(e.target.value)}
    />
  )
}));

describe('NotesWindowDetail', () => {
  const defaultProps = {
    noteId: 'note-1',
    onBack: vi.fn(),
    onDeleted: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDatabaseState.isUnlocked = true;
    mockDatabaseState.isLoading = false;
    limitResult = [mockNote];
    updateError = null;
    shouldResolve = false;
  });

  it('renders back button', () => {
    render(<NotesWindowDetail {...defaultProps} />);
    expect(screen.getByTestId('window-note-back')).toBeInTheDocument();
  });

  it('calls onBack when back button is clicked', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    render(<NotesWindowDetail {...defaultProps} onBack={onBack} />);

    await user.click(screen.getByTestId('window-note-back'));
    expect(onBack).toHaveBeenCalled();
  });

  it('renders component container', () => {
    const { container } = render(<NotesWindowDetail {...defaultProps} />);
    expect(container.firstChild).toBeInTheDocument();
  });

  it('shows database loading state', () => {
    mockDatabaseState.isLoading = true;
    mockDatabaseState.isUnlocked = false;
    render(<NotesWindowDetail {...defaultProps} />);
    expect(screen.getByText('Loading database...')).toBeInTheDocument();
  });

  it('shows unlock prompt when database is locked', () => {
    mockDatabaseState.isUnlocked = false;
    mockDatabaseState.isLoading = false;
    render(<NotesWindowDetail {...defaultProps} />);
    expect(screen.getByTestId('inline-unlock')).toBeInTheDocument();
  });

  it('displays note content after successful fetch', async () => {
    shouldResolve = true;
    limitResult = [mockNote];

    await act(async () => {
      render(<NotesWindowDetail {...defaultProps} />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('window-note-title')).toHaveValue('Test Note');
    });
    expect(screen.getByTestId('md-editor')).toHaveValue('# Hello World');
  });

  it('shows error when note is not found', async () => {
    shouldResolve = true;
    limitResult = [];

    await act(async () => {
      render(<NotesWindowDetail {...defaultProps} />);
    });

    await waitFor(() => {
      expect(screen.getByText('Note not found')).toBeInTheDocument();
    });
  });

  it('shows error when fetch fails', async () => {
    shouldResolve = true;
    limitResult = Promise.reject(new Error('Database error'));

    await act(async () => {
      render(<NotesWindowDetail {...defaultProps} />);
    });

    await waitFor(() => {
      expect(screen.getByText('Database error')).toBeInTheDocument();
    });
  });

  it('renders delete button when note is loaded', async () => {
    shouldResolve = true;
    limitResult = [mockNote];

    await act(async () => {
      render(<NotesWindowDetail {...defaultProps} />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('window-note-delete')).toBeInTheDocument();
    });
  });

  it('calls onDeleted when delete is successful', async () => {
    shouldResolve = true;
    limitResult = [mockNote];
    const user = userEvent.setup();
    const onDeleted = vi.fn();

    await act(async () => {
      render(<NotesWindowDetail {...defaultProps} onDeleted={onDeleted} />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('window-note-delete')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('window-note-delete'));

    await waitFor(() => {
      expect(onDeleted).toHaveBeenCalled();
    });
  });

  it('shows error when delete fails', async () => {
    shouldResolve = true;
    limitResult = [mockNote];
    const user = userEvent.setup();

    await act(async () => {
      render(<NotesWindowDetail {...defaultProps} />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('window-note-delete')).toBeInTheDocument();
    });

    // Set error for delete operation
    updateError = new Error('Delete failed');

    await user.click(screen.getByTestId('window-note-delete'));

    await waitFor(() => {
      expect(screen.getByText('Delete failed')).toBeInTheDocument();
    });
  });

  it('displays formatted date', async () => {
    shouldResolve = true;
    limitResult = [mockNote];

    await act(async () => {
      render(<NotesWindowDetail {...defaultProps} />);
    });

    await waitFor(() => {
      expect(screen.getByText(/Updated/)).toBeInTheDocument();
    });
  });

  it('applies correct color mode from theme', async () => {
    shouldResolve = true;
    limitResult = [mockNote];

    await act(async () => {
      render(<NotesWindowDetail {...defaultProps} />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('window-markdown-editor')).toHaveAttribute(
        'data-color-mode',
        'light'
      );
    });
  });

  it('auto-saves content changes after debounce', async () => {
    shouldResolve = true;
    limitResult = [mockNote];
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    await act(async () => {
      render(<NotesWindowDetail {...defaultProps} />);
      await vi.runAllTimersAsync();
    });

    await waitFor(() => {
      expect(screen.getByTestId('md-editor')).toBeInTheDocument();
    });

    await user.type(screen.getByTestId('md-editor'), ' new content');

    // Wait for debounce timer
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    // Content should have been saved (component updates internally)
    expect(screen.getByTestId('md-editor')).toHaveValue(
      '# Hello World new content'
    );

    vi.useRealTimers();
  });

  it('updates title when edited', async () => {
    shouldResolve = true;
    limitResult = [mockNote];
    const user = userEvent.setup();

    await act(async () => {
      render(<NotesWindowDetail {...defaultProps} />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('window-note-title')).toBeInTheDocument();
    });

    const titleInput = screen.getByTestId('window-note-title');
    await user.clear(titleInput);
    await user.type(titleInput, 'New Title');

    // Title should be updated in the input
    await waitFor(() => {
      expect(titleInput).toHaveValue('New Title');
    });
  });
});

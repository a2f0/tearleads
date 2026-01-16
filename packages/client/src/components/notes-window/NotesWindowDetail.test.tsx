import { render, screen } from '@testing-library/react';
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

// Mock getDatabase - return a promise that never resolves to avoid async state updates
const pendingPromise = new Promise(() => {
  /* never resolves */
});
const mockDb = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnValue(pendingPromise),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  delete: vi.fn().mockReturnThis()
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

  it('shows loading state while fetching note', () => {
    render(<NotesWindowDetail {...defaultProps} />);
    // The component shows "Loading note..." while the promise is pending
    expect(screen.getByText('Loading note...')).toBeInTheDocument();
  });

  it('does not fetch when database is locked', () => {
    mockDatabaseState.isUnlocked = false;
    render(<NotesWindowDetail {...defaultProps} />);

    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it('does not fetch when noteId is empty', () => {
    render(<NotesWindowDetail {...defaultProps} noteId="" />);

    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it('initiates fetch when database is unlocked', () => {
    render(<NotesWindowDetail {...defaultProps} />);

    expect(mockDb.select).toHaveBeenCalled();
  });
});

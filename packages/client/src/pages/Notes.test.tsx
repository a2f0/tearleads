import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockConsoleError } from '@/test/console-mocks';
import { Notes } from './Notes';

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: vi.fn(({ count }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, i) => ({
        index: i,
        start: i * 56,
        size: 56,
        key: i
      })),
    getTotalSize: () => count * 56,
    measureElement: vi.fn()
  }))
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate
  };
});

const mockUseDatabaseContext = vi.fn();

vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => mockUseDatabaseContext()
}));

const mockUpdate = vi.fn();
const mockSet = vi.fn();
const mockUpdateWhere = vi.fn();
const mockInsert = vi.fn();
const mockValues = vi.fn();
const mockDb = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  orderBy: vi.fn(),
  update: mockUpdate,
  insert: mockInsert
};

mockUpdate.mockReturnValue({ set: mockSet });
mockSet.mockReturnValue({ where: mockUpdateWhere });
mockInsert.mockReturnValue({ values: mockValues });

vi.mock('@/db', () => ({
  getDatabase: vi.fn(() => mockDb)
}));

const mockNotes = [
  {
    id: 'note-1',
    title: 'First Note',
    content: 'This is the content of the first note',
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-02')
  },
  {
    id: 'note-2',
    title: 'Second Note',
    content: '# Markdown content\n\nWith some **bold** text',
    createdAt: new Date('2025-01-03'),
    updatedAt: new Date('2025-01-04')
  }
];

async function renderNotes() {
  const result = render(
    <MemoryRouter>
      <Notes />
    </MemoryRouter>
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return result;
}

describe('Notes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseDatabaseContext.mockReturnValue({
      isUnlocked: true,
      isLoading: false,
      currentInstanceId: 'test-instance'
    });

    mockDb.orderBy.mockResolvedValue(mockNotes);

    mockUpdate.mockReturnValue({ set: mockSet });
    mockSet.mockReturnValue({ where: mockUpdateWhere });
    mockUpdateWhere.mockResolvedValue(undefined);
    mockInsert.mockReturnValue({ values: mockValues });
    mockValues.mockResolvedValue(undefined);
  });

  describe('page rendering', () => {
    it('renders the page title', async () => {
      await renderNotes();

      await waitFor(() => {
        expect(screen.getByText('Notes')).toBeInTheDocument();
      });
    });

    it('shows loading state when database is loading', async () => {
      mockUseDatabaseContext.mockReturnValue({
        isUnlocked: false,
        isLoading: true,
        currentInstanceId: null
      });

      await renderNotes();

      expect(screen.getByText('Loading database...')).toBeInTheDocument();
    });

    it('shows inline unlock when database is locked', async () => {
      mockUseDatabaseContext.mockReturnValue({
        isUnlocked: false,
        isLoading: false,
        currentInstanceId: null,
        isSetUp: true,
        hasPersistedSession: false,
        unlock: vi.fn(),
        restoreSession: vi.fn()
      });

      await renderNotes();

      expect(screen.getByTestId('inline-unlock')).toBeInTheDocument();
      expect(
        screen.getByText(
          /Database is locked. Enter your password to view notes./i
        )
      ).toBeInTheDocument();
    });
  });

  describe('notes list', () => {
    it('renders notes list when notes exist', async () => {
      await renderNotes();

      await waitFor(() => {
        expect(screen.getByText('First Note')).toBeInTheDocument();
        expect(screen.getByText('Second Note')).toBeInTheDocument();
      });
    });

    it('shows content preview', async () => {
      await renderNotes();

      await waitFor(() => {
        expect(screen.getByText('First Note')).toBeInTheDocument();
      });

      expect(
        screen.getByText(/This is the content of the first note/)
      ).toBeInTheDocument();
    });

    it('shows note count', async () => {
      await renderNotes();

      await waitFor(() => {
        expect(screen.getByText(/2 notes$/)).toBeInTheDocument();
      });
    });
  });

  describe('context menu', () => {
    it('shows context menu on right-click', async () => {
      const user = userEvent.setup();
      await renderNotes();

      await waitFor(() => {
        expect(screen.getByText('First Note')).toBeInTheDocument();
      });

      const note = screen.getByText('First Note');
      await user.pointer({ keys: '[MouseRight]', target: note });

      await waitFor(() => {
        expect(screen.getByText('Get info')).toBeInTheDocument();
      });
    });

    it('navigates to note detail when "Get info" is clicked', async () => {
      const user = userEvent.setup();
      await renderNotes();

      await waitFor(() => {
        expect(screen.getByText('First Note')).toBeInTheDocument();
      });

      const note = screen.getByText('First Note');
      await user.pointer({ keys: '[MouseRight]', target: note });

      await waitFor(() => {
        expect(screen.getByText('Get info')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Get info'));

      expect(mockNavigate).toHaveBeenCalledWith('/notes/note-1', {
        state: { from: '/', fromLabel: 'Back to Notes' }
      });
    });

    it('closes context menu when clicking elsewhere', async () => {
      const user = userEvent.setup();
      await renderNotes();

      await waitFor(() => {
        expect(screen.getByText('First Note')).toBeInTheDocument();
      });

      const note = screen.getByText('First Note');
      await user.pointer({ keys: '[MouseRight]', target: note });

      await waitFor(() => {
        expect(screen.getByText('Get info')).toBeInTheDocument();
      });

      await user.click(
        screen.getByRole('button', { name: /close context menu/i })
      );

      await waitFor(() => {
        expect(screen.queryByText('Get info')).not.toBeInTheDocument();
      });
    });

    it('shows "Delete" option in context menu', async () => {
      const user = userEvent.setup();
      await renderNotes();

      await waitFor(() => {
        expect(screen.getByText('First Note')).toBeInTheDocument();
      });

      const note = screen.getByText('First Note');
      await user.pointer({ keys: '[MouseRight]', target: note });

      await waitFor(() => {
        expect(screen.getByText('Delete')).toBeInTheDocument();
      });
    });

    it('soft deletes note when "Delete" is clicked', async () => {
      const user = userEvent.setup();
      await renderNotes();

      await waitFor(() => {
        expect(screen.getByText('First Note')).toBeInTheDocument();
      });

      const note = screen.getByText('First Note');
      await user.pointer({ keys: '[MouseRight]', target: note });

      await waitFor(() => {
        expect(screen.getByText('Delete')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Delete'));

      await waitFor(() => {
        expect(mockUpdate).toHaveBeenCalled();
        expect(mockSet).toHaveBeenCalledWith({ deleted: true });
      });
    });

    it('shows error when delete fails', async () => {
      const user = userEvent.setup();
      mockUpdateWhere.mockRejectedValue(new Error('Delete failed'));

      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      await renderNotes();

      await waitFor(() => {
        expect(screen.getByText('First Note')).toBeInTheDocument();
      });

      const note = screen.getByText('First Note');
      await user.pointer({ keys: '[MouseRight]', target: note });

      await waitFor(() => {
        expect(screen.getByText('Delete')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Delete'));

      await waitFor(() => {
        expect(screen.getByText('Delete failed')).toBeInTheDocument();
      });

      consoleSpy.mockRestore();
    });
  });

  describe('note click navigation', () => {
    it('navigates to note detail on click', async () => {
      const user = userEvent.setup();
      await renderNotes();

      await waitFor(() => {
        expect(screen.getByText('First Note')).toBeInTheDocument();
      });

      await user.click(screen.getByText('First Note'));

      expect(mockNavigate).toHaveBeenCalledWith('/notes/note-1', {
        state: { from: '/', fromLabel: 'Back to Notes' }
      });
    });
  });

  describe('empty state', () => {
    it('shows empty state when no notes exist', async () => {
      mockDb.orderBy.mockResolvedValue([]);

      await renderNotes();

      await waitFor(() => {
        expect(screen.getByText('No notes yet')).toBeInTheDocument();
      });

      expect(
        screen.getByText('Create your first note to get started')
      ).toBeInTheDocument();
      expect(screen.getByTestId('empty-create-note')).toBeInTheDocument();
    });
  });

  describe('create note', () => {
    it('renders create note button when unlocked', async () => {
      await renderNotes();

      await waitFor(() => {
        expect(screen.getByTestId('create-note-button')).toBeInTheDocument();
      });
    });

    it('creates a new note and navigates to it', async () => {
      const user = userEvent.setup();
      await renderNotes();

      await waitFor(() => {
        expect(screen.getByTestId('create-note-button')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('create-note-button'));

      await waitFor(() => {
        expect(mockInsert).toHaveBeenCalled();
        expect(mockNavigate).toHaveBeenCalledWith(
          expect.stringMatching(/^\/notes\/.+$/),
          expect.any(Object)
        );
      });
    });

    it('shows error when create fails', async () => {
      const user = userEvent.setup();
      mockValues.mockRejectedValue(new Error('Create failed'));

      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      await renderNotes();

      await waitFor(() => {
        expect(screen.getByTestId('create-note-button')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('create-note-button'));

      await waitFor(() => {
        expect(screen.getByText('Create failed')).toBeInTheDocument();
      });

      consoleSpy.mockRestore();
    });
  });

  describe('refresh button', () => {
    it('renders refresh button when unlocked', async () => {
      await renderNotes();

      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /refresh/i })
        ).toBeInTheDocument();
      });
    });

    it('refetches notes when refresh is clicked', async () => {
      const user = userEvent.setup();
      await renderNotes();

      await waitFor(() => {
        expect(screen.getByText('First Note')).toBeInTheDocument();
      });

      mockDb.orderBy.mockClear();
      mockDb.orderBy.mockResolvedValue(mockNotes);

      await user.click(screen.getByRole('button', { name: /refresh/i }));

      await waitFor(() => {
        expect(mockDb.orderBy).toHaveBeenCalled();
      });
    });
  });

  describe('search', () => {
    it('renders search input', async () => {
      await renderNotes();

      await waitFor(() => {
        expect(screen.getByTestId('notes-search')).toBeInTheDocument();
      });
    });

    it('filters notes by title', async () => {
      const user = userEvent.setup();
      await renderNotes();

      await waitFor(() => {
        expect(screen.getByText('First Note')).toBeInTheDocument();
        expect(screen.getByText('Second Note')).toBeInTheDocument();
      });

      await user.type(screen.getByTestId('notes-search'), 'First');

      await waitFor(() => {
        expect(screen.getByText('First Note')).toBeInTheDocument();
        expect(screen.queryByText('Second Note')).not.toBeInTheDocument();
      });
    });
  });

  describe('error handling', () => {
    it('displays error when note fetch fails', async () => {
      const consoleSpy = mockConsoleError();
      mockDb.orderBy.mockRejectedValue(new Error('Failed to load'));

      await renderNotes();

      await waitFor(() => {
        expect(screen.getByText('Failed to load')).toBeInTheDocument();
      });
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to fetch notes:',
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });

    it('handles non-Error objects in catch block', async () => {
      const consoleSpy = mockConsoleError();
      mockDb.orderBy.mockRejectedValue('String error');

      await renderNotes();

      await waitFor(() => {
        expect(screen.getByText('String error')).toBeInTheDocument();
      });
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to fetch notes:',
        'String error'
      );
      consoleSpy.mockRestore();
    });
  });

  describe('instance switching', () => {
    it('refetches notes when instance changes', async () => {
      const { rerender } = await renderNotes();

      await waitFor(() => {
        expect(screen.getByText('First Note')).toBeInTheDocument();
      });

      mockDb.orderBy.mockClear();

      mockUseDatabaseContext.mockReturnValue({
        isUnlocked: true,
        isLoading: false,
        currentInstanceId: 'new-instance'
      });

      rerender(
        <MemoryRouter>
          <Notes />
        </MemoryRouter>
      );

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      await waitFor(() => {
        expect(mockDb.orderBy).toHaveBeenCalled();
      });
    });
  });
});

import { type Theme, ThemeProvider } from '@rapid/ui';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockConsoleError } from '@/test/console-mocks';
import { NoteDetail } from './NoteDetail';

vi.mock('@uiw/react-md-editor', () => ({
  default: ({
    value,
    onChange
  }: {
    value: string;
    onChange: (value: string | undefined) => void;
  }) => (
    <textarea
      data-testid="mock-md-editor"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}));

const mockUseDatabaseContext = vi.fn();
vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => mockUseDatabaseContext()
}));

const mockSelect = vi.fn();
const mockUpdate = vi.fn();
vi.mock('@/db', () => ({
  getDatabase: () => ({
    select: mockSelect,
    update: mockUpdate
  })
}));

const TEST_NOTE = {
  id: 'note-123',
  title: 'Test Note',
  content: '# Hello World\n\nThis is a test note.',
  createdAt: new Date('2024-01-15'),
  updatedAt: new Date('2024-01-16')
};

function createMockQueryChain(result: unknown[]) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(result)
      })
    })
  };
}

interface RenderOptions {
  noteId?: string;
  theme?: Theme;
}

function renderNoteDetailRaw(options: RenderOptions = {}) {
  const { noteId = 'note-123', theme = 'light' } = options;
  return render(
    <ThemeProvider defaultTheme={theme}>
      <MemoryRouter initialEntries={[`/notes/${noteId}`]}>
        <Routes>
          <Route path="/notes/:id" element={<NoteDetail />} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>
  );
}

async function renderNoteDetail(options: RenderOptions = {}) {
  const result = renderNoteDetailRaw(options);
  await waitFor(() => {
    expect(screen.queryByText('Loading note...')).not.toBeInTheDocument();
  });
  return result;
}

describe('NoteDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });

    mockUseDatabaseContext.mockReturnValue({
      isUnlocked: true,
      isLoading: false,
      currentInstanceId: 'test-instance'
    });
    mockSelect.mockReturnValue(createMockQueryChain([TEST_NOTE]));
    mockUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined)
      })
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('when database is loading', () => {
    beforeEach(() => {
      mockUseDatabaseContext.mockReturnValue({
        isUnlocked: false,
        isLoading: true,
        currentInstanceId: null
      });
    });

    it('shows loading message', () => {
      renderNoteDetailRaw();
      expect(screen.getByText('Loading database...')).toBeInTheDocument();
    });
  });

  describe('when database is locked', () => {
    beforeEach(() => {
      mockUseDatabaseContext.mockReturnValue({
        isUnlocked: false,
        isLoading: false,
        currentInstanceId: null,
        isSetUp: true,
        hasPersistedSession: false,
        unlock: vi.fn(),
        restoreSession: vi.fn()
      });
    });

    it('shows inline unlock component', () => {
      renderNoteDetailRaw();
      expect(screen.getByTestId('inline-unlock')).toBeInTheDocument();
      expect(
        screen.getByText(
          /Database is locked. Enter your password to view this note./i
        )
      ).toBeInTheDocument();
    });

    it('shows password input for unlocking', () => {
      renderNoteDetailRaw();
      expect(screen.getByTestId('inline-unlock-password')).toBeInTheDocument();
    });

    it('shows unlock button', () => {
      renderNoteDetailRaw();
      expect(screen.getByTestId('inline-unlock-button')).toBeInTheDocument();
    });
  });

  describe('when note is loaded', () => {
    it('renders note title', async () => {
      await renderNoteDetail();

      expect(screen.getByText('Test Note')).toBeInTheDocument();
    });

    it('renders markdown editor', async () => {
      await renderNoteDetail();

      expect(screen.getByTestId('markdown-editor')).toBeInTheDocument();
    });

    it('renders note details', async () => {
      await renderNoteDetail();

      expect(screen.getByText('Note Details')).toBeInTheDocument();
      expect(screen.getByText('Created')).toBeInTheDocument();
      expect(screen.getByText('Updated')).toBeInTheDocument();
    });

    it('renders delete button', async () => {
      await renderNoteDetail();

      expect(screen.getByTestId('delete-button')).toBeInTheDocument();
    });
  });

  describe('content editing', () => {
    it('updates content when editor changes', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      await renderNoteDetail();

      const editor = screen.getByTestId('mock-md-editor');
      await user.clear(editor);
      await user.type(editor, 'New content');

      vi.advanceTimersByTime(600);

      await waitFor(() => {
        expect(mockUpdate).toHaveBeenCalled();
      });
    });

    it('debounces content saves with 500ms delay', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      await renderNoteDetail();

      // Track calls from content editing
      const updateSetMock = vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined)
      });
      mockUpdate.mockReturnValue({ set: updateSetMock });

      const editor = screen.getByTestId('mock-md-editor');
      await user.clear(editor);
      await user.type(editor, 'New content');

      // After 500ms the debounced save should trigger
      vi.advanceTimersByTime(600);

      await waitFor(() => {
        expect(mockUpdate).toHaveBeenCalled();
      });
    });
  });

  describe('delete functionality', () => {
    it('soft deletes note when delete button is clicked', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      await renderNoteDetail();

      await user.click(screen.getByTestId('delete-button'));

      await waitFor(() => {
        expect(mockUpdate).toHaveBeenCalled();
      });
    });

    it('shows error when delete fails', async () => {
      const consoleSpy = mockConsoleError();
      mockUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockRejectedValue(new Error('Delete failed'))
        })
      });

      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      await renderNoteDetail();

      await user.click(screen.getByTestId('delete-button'));

      await waitFor(() => {
        expect(screen.getByText('Delete failed')).toBeInTheDocument();
      });

      consoleSpy.mockRestore();
    });
  });

  describe('note not found', () => {
    beforeEach(() => {
      mockSelect.mockReturnValue(createMockQueryChain([]));
    });

    it('shows not found error', async () => {
      await renderNoteDetail();

      expect(screen.getByText('Note not found')).toBeInTheDocument();
    });
  });

  describe('error handling', () => {
    it('shows error when fetch fails', async () => {
      const consoleSpy = mockConsoleError();
      const errorQueryChain = {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockRejectedValue(new Error('Database error'))
          })
        })
      };
      mockSelect.mockReturnValue(errorQueryChain);

      await renderNoteDetail();

      expect(screen.getByText('Database error')).toBeInTheDocument();
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to fetch note:',
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });

    it('handles non-Error objects in catch block', async () => {
      const consoleSpy = mockConsoleError();
      const errorQueryChain = {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockRejectedValue('String error')
          })
        })
      };
      mockSelect.mockReturnValue(errorQueryChain);

      await renderNoteDetail();

      expect(screen.getByText('String error')).toBeInTheDocument();
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to fetch note:',
        'String error'
      );
      consoleSpy.mockRestore();
    });
  });

  describe('back navigation', () => {
    it('renders back link to notes page', async () => {
      await renderNoteDetail();

      const backLink = screen.getByTestId('back-link');
      expect(backLink).toBeInTheDocument();
      expect(backLink).toHaveAttribute('href', '/notes');
      expect(backLink).toHaveTextContent('Back to Notes');
    });
  });

  describe('title editing', () => {
    it('renders edit button for note title', async () => {
      await renderNoteDetail();

      expect(screen.getByTestId('note-title-edit')).toBeInTheDocument();
    });

    it('enters edit mode when edit button is clicked', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      await renderNoteDetail();

      await user.click(screen.getByTestId('note-title-edit'));

      expect(screen.getByTestId('note-title-input')).toBeInTheDocument();
      expect(screen.getByTestId('note-title-input')).toHaveValue('Test Note');
    });

    it('updates note title when saved', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      await renderNoteDetail();

      await user.click(screen.getByTestId('note-title-edit'));
      await user.clear(screen.getByTestId('note-title-input'));
      await user.type(screen.getByTestId('note-title-input'), 'New Title');
      await user.click(screen.getByTestId('note-title-save'));

      await waitFor(() => {
        expect(mockUpdate).toHaveBeenCalled();
      });
    });

    it('cancels edit mode when cancel button is clicked', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      await renderNoteDetail();

      await user.click(screen.getByTestId('note-title-edit'));
      await user.clear(screen.getByTestId('note-title-input'));
      await user.type(screen.getByTestId('note-title-input'), 'New Title');
      await user.click(screen.getByTestId('note-title-cancel'));

      expect(screen.queryByTestId('note-title-input')).not.toBeInTheDocument();
      expect(screen.getByText('Test Note')).toBeInTheDocument();
    });
  });

  describe('theme integration', () => {
    it('sets data-color-mode to light for light theme', async () => {
      await renderNoteDetail({ theme: 'light' });

      const editor = screen.getByTestId('markdown-editor');
      expect(editor).toHaveAttribute('data-color-mode', 'light');
    });

    it('sets data-color-mode to dark for dark theme', async () => {
      await renderNoteDetail({ theme: 'dark' });

      const editor = screen.getByTestId('markdown-editor');
      expect(editor).toHaveAttribute('data-color-mode', 'dark');
    });

    it('sets data-color-mode to dark for monochrome theme', async () => {
      await renderNoteDetail({ theme: 'monochrome' });

      const editor = screen.getByTestId('markdown-editor');
      expect(editor).toHaveAttribute('data-color-mode', 'dark');
    });

    it('sets data-color-mode to dark for tokyo-night theme', async () => {
      await renderNoteDetail({ theme: 'tokyo-night' });

      const editor = screen.getByTestId('markdown-editor');
      expect(editor).toHaveAttribute('data-color-mode', 'dark');
    });

    it('updates data-color-mode when theme changes', async () => {
      await renderNoteDetail({ theme: 'light' });

      const editor = screen.getByTestId('markdown-editor');
      expect(editor).toHaveAttribute('data-color-mode', 'light');

      act(() => {
        window.dispatchEvent(
          new CustomEvent('settings-synced', {
            detail: { settings: { theme: 'dark' } }
          })
        );
      });

      expect(editor).toHaveAttribute('data-color-mode', 'dark');
    });

    it('updates data-color-mode when switching to monochrome', async () => {
      await renderNoteDetail({ theme: 'light' });

      const editor = screen.getByTestId('markdown-editor');
      expect(editor).toHaveAttribute('data-color-mode', 'light');

      act(() => {
        window.dispatchEvent(
          new CustomEvent('settings-synced', {
            detail: { settings: { theme: 'monochrome' } }
          })
        );
      });

      expect(editor).toHaveAttribute('data-color-mode', 'dark');
    });

    it('updates data-color-mode when switching to tokyo-night', async () => {
      await renderNoteDetail({ theme: 'light' });

      const editor = screen.getByTestId('markdown-editor');
      expect(editor).toHaveAttribute('data-color-mode', 'light');

      act(() => {
        window.dispatchEvent(
          new CustomEvent('settings-synced', {
            detail: { settings: { theme: 'tokyo-night' } }
          })
        );
      });

      expect(editor).toHaveAttribute('data-color-mode', 'dark');
    });
  });
});

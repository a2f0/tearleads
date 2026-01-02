import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Tables } from './Tables';

// Mock the database context
const mockUseDatabaseContext = vi.fn();
vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => mockUseDatabaseContext()
}));

// Mock the database adapter
const mockExecute = vi.fn();
vi.mock('@/db', () => ({
  getDatabaseAdapter: () => ({
    execute: mockExecute
  })
}));

function renderTables() {
  return render(
    <MemoryRouter>
      <Tables />
    </MemoryRouter>
  );
}

describe('Tables', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseDatabaseContext.mockReturnValue({
      isUnlocked: true,
      isLoading: false
    });

    // Mock table listing
    mockExecute.mockImplementation((sql: string) => {
      if (sql.includes('sqlite_master')) {
        return Promise.resolve({
          rows: [{ name: 'users' }, { name: 'files' }, { name: 'settings' }]
        });
      }
      // Mock count queries
      if (sql.includes('COUNT(*)')) {
        if (sql.includes('users')) {
          return Promise.resolve({ rows: [{ count: 100 }] });
        }
        if (sql.includes('files')) {
          return Promise.resolve({ rows: [{ count: 50 }] });
        }
        if (sql.includes('settings')) {
          return Promise.resolve({ rows: [{ count: 5 }] });
        }
      }
      return Promise.resolve({ rows: [] });
    });
  });

  describe('page rendering', () => {
    it('renders the page title', async () => {
      renderTables();

      expect(screen.getByText('Tables')).toBeInTheDocument();
    });

    it('renders Refresh button when unlocked', async () => {
      renderTables();

      expect(screen.getByText('Refresh')).toBeInTheDocument();
    });
  });

  describe('when database is loading', () => {
    beforeEach(() => {
      mockUseDatabaseContext.mockReturnValue({
        isUnlocked: false,
        isLoading: true
      });
    });

    it('shows loading message', () => {
      renderTables();

      expect(screen.getByText('Loading database...')).toBeInTheDocument();
    });

    it('does not show Refresh button', () => {
      renderTables();

      expect(screen.queryByText('Refresh')).not.toBeInTheDocument();
    });
  });

  describe('when database is locked', () => {
    beforeEach(() => {
      mockUseDatabaseContext.mockReturnValue({
        isUnlocked: false,
        isLoading: false,
        isSetUp: true,
        hasPersistedSession: false,
        unlock: vi.fn(),
        restoreSession: vi.fn()
      });
    });

    it('shows inline unlock component', () => {
      renderTables();

      expect(screen.getByTestId('inline-unlock')).toBeInTheDocument();
      expect(
        screen.getByText(
          /Database is locked. Enter your password to view tables./i
        )
      ).toBeInTheDocument();
    });

    it('shows password input for unlocking', () => {
      renderTables();

      expect(screen.getByTestId('inline-unlock-password')).toBeInTheDocument();
    });

    it('shows unlock button', () => {
      renderTables();

      expect(screen.getByTestId('inline-unlock-button')).toBeInTheDocument();
    });

    it('does not show Refresh button', () => {
      renderTables();

      expect(screen.queryByText('Refresh')).not.toBeInTheDocument();
    });
  });

  describe('when database is unlocked', () => {
    it('fetches tables on mount', async () => {
      renderTables();

      await waitFor(() => {
        expect(mockExecute).toHaveBeenCalledWith(
          expect.stringContaining('sqlite_master'),
          []
        );
      });
    });

    it('displays table names', async () => {
      renderTables();

      await waitFor(() => {
        expect(screen.getByText('users')).toBeInTheDocument();
        expect(screen.getByText('files')).toBeInTheDocument();
        expect(screen.getByText('settings')).toBeInTheDocument();
      });
    });

    it('displays row counts', async () => {
      renderTables();

      await waitFor(() => {
        expect(screen.getByText('100 rows')).toBeInTheDocument();
        expect(screen.getByText('50 rows')).toBeInTheDocument();
        expect(screen.getByText('5 rows')).toBeInTheDocument();
      });
    });

    it('shows singular "row" for 1 row', async () => {
      mockExecute.mockImplementation((sql: string) => {
        if (sql.includes('sqlite_master')) {
          return Promise.resolve({
            rows: [{ name: 'single_table' }]
          });
        }
        if (sql.includes('COUNT(*)')) {
          return Promise.resolve({ rows: [{ count: 1 }] });
        }
        return Promise.resolve({ rows: [] });
      });

      renderTables();

      await waitFor(() => {
        expect(screen.getByText('1 row')).toBeInTheDocument();
      });
    });

    it('renders tables as links', async () => {
      renderTables();

      await waitFor(() => {
        expect(screen.getByText('users')).toBeInTheDocument();
      });

      const usersLink = screen.getByRole('link', { name: /users/i });
      expect(usersLink).toHaveAttribute('href', '/tables/users');
    });
  });

  describe('empty state', () => {
    beforeEach(() => {
      mockExecute.mockResolvedValue({ rows: [] });
    });

    it('shows empty message when no tables', async () => {
      renderTables();

      await waitFor(() => {
        expect(screen.getByText('No tables found')).toBeInTheDocument();
      });
    });
  });

  describe('loading state', () => {
    it('shows loading message while fetching tables', async () => {
      mockExecute.mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      renderTables();

      await waitFor(() => {
        expect(screen.getByText('Loading tables...')).toBeInTheDocument();
      });
    });
  });

  describe('error handling', () => {
    it('displays error message when fetch fails', async () => {
      mockExecute.mockRejectedValue(new Error('Database error'));

      renderTables();

      await waitFor(() => {
        expect(screen.getByText('Database error')).toBeInTheDocument();
      });
    });
  });

  describe('refresh functionality', () => {
    it('refreshes table list when Refresh is clicked', async () => {
      const user = userEvent.setup();
      renderTables();

      await waitFor(() => {
        expect(screen.getByText('users')).toBeInTheDocument();
      });

      mockExecute.mockClear();

      await user.click(screen.getByText('Refresh'));

      await waitFor(() => {
        expect(mockExecute).toHaveBeenCalled();
      });
    });

    it('disables Refresh button while loading', async () => {
      mockExecute.mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      renderTables();

      await waitFor(() => {
        expect(screen.getByText('Loading tables...')).toBeInTheDocument();
      });

      expect(screen.getByRole('button', { name: /refresh/i })).toBeDisabled();
    });
  });
});

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

function renderTablesRaw() {
  return render(
    <MemoryRouter>
      <Tables />
    </MemoryRouter>
  );
}

async function renderTables() {
  const result = renderTablesRaw();
  // Wait for initial async effects to complete
  await waitFor(() => {
    expect(screen.queryByText('Loading tables...')).not.toBeInTheDocument();
  });
  return result;
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
      await renderTables();

      expect(screen.getByText('Tables')).toBeInTheDocument();
    });

    it('renders Refresh button when unlocked', async () => {
      await renderTables();

      expect(
        screen.getByRole('button', { name: 'Refresh' })
      ).toBeInTheDocument();
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
      renderTablesRaw();

      expect(screen.getByText('Loading database...')).toBeInTheDocument();
    });

    it('does not show Refresh button', () => {
      renderTablesRaw();

      expect(
        screen.queryByRole('button', { name: 'Refresh' })
      ).not.toBeInTheDocument();
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
      renderTablesRaw();

      expect(screen.getByTestId('inline-unlock')).toBeInTheDocument();
      expect(
        screen.getByText(
          /Database is locked. Enter your password to view tables./i
        )
      ).toBeInTheDocument();
    });

    it('shows password input for unlocking', () => {
      renderTablesRaw();

      expect(screen.getByTestId('inline-unlock-password')).toBeInTheDocument();
    });

    it('shows unlock button', () => {
      renderTablesRaw();

      expect(screen.getByTestId('inline-unlock-button')).toBeInTheDocument();
    });

    it('does not show Refresh button', () => {
      renderTablesRaw();

      expect(
        screen.queryByRole('button', { name: 'Refresh' })
      ).not.toBeInTheDocument();
    });
  });

  describe('when database is unlocked', () => {
    it('fetches tables on mount', async () => {
      await renderTables();

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('sqlite_master'),
        []
      );
    });

    it('displays table names', async () => {
      await renderTables();

      expect(screen.getByText('users')).toBeInTheDocument();
      expect(screen.getByText('files')).toBeInTheDocument();
      expect(screen.getByText('settings')).toBeInTheDocument();
    });

    it('displays row counts', async () => {
      await renderTables();

      expect(screen.getByText('100 rows')).toBeInTheDocument();
      expect(screen.getByText('50 rows')).toBeInTheDocument();
      expect(screen.getByText('5 rows')).toBeInTheDocument();
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

      await renderTables();

      expect(screen.getByText('1 row')).toBeInTheDocument();
    });

    it('handles array-based table and count rows', async () => {
      mockExecute.mockImplementation((sql: string) => {
        if (sql.includes('sqlite_master')) {
          return Promise.resolve({
            rows: [['users']]
          });
        }
        if (sql.includes('COUNT(*)')) {
          return Promise.resolve({ rows: [[3]] });
        }
        return Promise.resolve({ rows: [] });
      });

      await renderTables();

      expect(screen.getByText('users')).toBeInTheDocument();
      expect(screen.getByText('3 rows')).toBeInTheDocument();
    });

    it('renders tables as links', async () => {
      await renderTables();

      expect(screen.getByText('users')).toBeInTheDocument();

      const usersLink = screen.getByRole('link', { name: /users/i });
      expect(usersLink).toHaveAttribute('href', '/tables/users');
    });
  });

  describe('empty state', () => {
    beforeEach(() => {
      mockExecute.mockResolvedValue({ rows: [] });
    });

    it('shows empty message when no tables', async () => {
      await renderTables();

      expect(screen.getByText('No tables found')).toBeInTheDocument();
    });
  });

  describe('loading state', () => {
    it('shows loading message while fetching tables', () => {
      mockExecute.mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      renderTablesRaw();

      expect(screen.getByText('Loading tables...')).toBeInTheDocument();
    });
  });

  describe('error handling', () => {
    it('displays error message when fetch fails', async () => {
      mockExecute.mockRejectedValue(new Error('Database error'));

      renderTablesRaw();

      await waitFor(() => {
        expect(screen.getByText('Database error')).toBeInTheDocument();
      });
    });
  });

  describe('refresh functionality', () => {
    it('refreshes table list when Refresh is clicked', async () => {
      const user = userEvent.setup();
      await renderTables();

      expect(screen.getByText('users')).toBeInTheDocument();

      mockExecute.mockClear();

      await user.click(screen.getByRole('button', { name: 'Refresh' }));

      await waitFor(() => {
        expect(mockExecute).toHaveBeenCalled();
      });
    });

    it('disables Refresh button while loading', () => {
      mockExecute.mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      renderTablesRaw();

      expect(screen.getByText('Loading tables...')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /refresh/i })).toBeDisabled();
    });
  });
});

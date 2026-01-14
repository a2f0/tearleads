import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockConsoleError } from '@/test/console-mocks';
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
  // Flush the setTimeout(fn, 0) used for instance-aware fetching
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
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
      isLoading: false,
      currentInstanceId: 'test-instance'
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

    it('filters out non-object table rows', async () => {
      mockExecute.mockImplementation((sql: string) => {
        if (sql.includes('sqlite_master')) {
          return Promise.resolve({
            rows: [null, { name: 'users' }]
          });
        }
        if (sql.includes('COUNT(*)')) {
          return Promise.resolve({ rows: [{ count: 2 }] });
        }
        return Promise.resolve({ rows: [] });
      });

      await renderTables();

      expect(screen.getByText('users')).toBeInTheDocument();
      expect(screen.getByText('2 rows')).toBeInTheDocument();
    });

    it('parses string counts', async () => {
      mockExecute.mockImplementation((sql: string) => {
        if (sql.includes('sqlite_master')) {
          return Promise.resolve({
            rows: [{ name: 'logs' }]
          });
        }
        if (sql.includes('COUNT(*)')) {
          return Promise.resolve({ rows: [{ count: '12' }] });
        }
        return Promise.resolve({ rows: [] });
      });

      await renderTables();

      expect(screen.getByText('logs')).toBeInTheDocument();
      expect(screen.getByText('12 rows')).toBeInTheDocument();
    });

    it('shows an error when counts are invalid', async () => {
      const consoleSpy = mockConsoleError();
      mockExecute.mockImplementation((sql: string) => {
        if (sql.includes('sqlite_master')) {
          return Promise.resolve({
            rows: [{ name: 'users' }]
          });
        }
        if (sql.includes('COUNT(*)')) {
          return Promise.resolve({ rows: [{ count: 'oops' }] });
        }
        return Promise.resolve({ rows: [] });
      });

      renderTablesRaw();

      await waitFor(() => {
        expect(
          screen.getByText('Unexpected count format for table "users"')
        ).toBeInTheDocument();
      });
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to fetch tables:',
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });

    it('shows an error when count rows are missing', async () => {
      const consoleSpy = mockConsoleError();
      mockExecute.mockImplementation((sql: string) => {
        if (sql.includes('sqlite_master')) {
          return Promise.resolve({
            rows: [{ name: 'users' }]
          });
        }
        if (sql.includes('COUNT(*)')) {
          return Promise.resolve({ rows: [null] });
        }
        return Promise.resolve({ rows: [] });
      });

      renderTablesRaw();

      await waitFor(() => {
        expect(
          screen.getByText('Unexpected count format for table "users"')
        ).toBeInTheDocument();
      });
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to fetch tables:',
        expect.any(Error)
      );
      consoleSpy.mockRestore();
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
    it('shows loading message while fetching tables', async () => {
      mockExecute.mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      renderTablesRaw();

      // Flush the setTimeout used for instance-aware fetching
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(screen.getByText('Loading tables...')).toBeInTheDocument();
    });
  });

  describe('error handling', () => {
    it('displays error message when fetch fails', async () => {
      const consoleSpy = mockConsoleError();
      mockExecute.mockRejectedValue(new Error('Database error'));

      renderTablesRaw();

      await waitFor(() => {
        expect(screen.getByText('Database error')).toBeInTheDocument();
      });
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to fetch tables:',
        expect.any(Error)
      );
      consoleSpy.mockRestore();
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

    it('disables Refresh button while loading', async () => {
      mockExecute.mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      renderTablesRaw();

      // Flush the setTimeout used for instance-aware fetching
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(screen.getByText('Loading tables...')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /refresh/i })).toBeDisabled();
    });
  });

  describe('instance switching', () => {
    it('refetches tables when instance changes', async () => {
      const { rerender } = await renderTables();

      expect(screen.getByText('users')).toBeInTheDocument();

      // Clear mocks to track new calls
      mockExecute.mockClear();

      // Change the instance
      mockUseDatabaseContext.mockReturnValue({
        isUnlocked: true,
        isLoading: false,
        currentInstanceId: 'new-instance'
      });

      // Re-render with the new instance context
      rerender(
        <MemoryRouter>
          <Tables />
        </MemoryRouter>
      );

      // Flush the setTimeout for instance-aware fetching
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      // Verify that tables were fetched again
      await waitFor(() => {
        expect(mockExecute).toHaveBeenCalled();
      });
    });
  });
});

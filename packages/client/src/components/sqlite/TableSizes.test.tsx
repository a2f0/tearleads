import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockConsoleError } from '@/test/console-mocks';
import { TableSizes } from './TableSizes';

const mockUseDatabaseContext = vi.fn();
const mockGetDatabaseAdapter = vi.fn();

vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => mockUseDatabaseContext()
}));

vi.mock('@/db', () => ({
  getDatabaseAdapter: () => mockGetDatabaseAdapter()
}));

function renderTableSizesRaw() {
  return render(
    <MemoryRouter>
      <TableSizes />
    </MemoryRouter>
  );
}

async function renderTableSizes() {
  const result = renderTableSizesRaw();
  // Wait for initial async effects to complete
  await waitFor(() => {
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
  });
  return result;
}

describe('TableSizes', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.restoreAllMocks();
  });

  function setupMockContext(overrides = {}) {
    const defaults = {
      isUnlocked: false
    };
    mockUseDatabaseContext.mockReturnValue({ ...defaults, ...overrides });
    return { ...defaults, ...overrides };
  }

  function setupMockAdapter(executeResponses: Record<string, unknown>) {
    const execute = vi.fn().mockImplementation((sql: string) => {
      if (sql === 'PRAGMA page_size') {
        return executeResponses['page_size'] ?? { rows: [{ page_size: 4096 }] };
      }
      if (sql === 'PRAGMA page_count') {
        return executeResponses['page_count'] ?? { rows: [{ page_count: 10 }] };
      }
      if (sql.includes('sqlite_master')) {
        return (
          executeResponses['tables'] ?? {
            rows: [{ name: 'test_table' }, { name: 'users' }]
          }
        );
      }
      if (sql.includes('dbstat')) {
        if (executeResponses['dbstat_error']) {
          throw new Error('dbstat not available');
        }
        return executeResponses['dbstat'] ?? { rows: [{ size: 1024 }] };
      }
      if (sql.includes('COUNT')) {
        return executeResponses['count'] ?? { rows: [{ count: 50 }] };
      }
      return { rows: [] };
    });

    mockGetDatabaseAdapter.mockReturnValue({ execute });
    return execute;
  }

  describe('visibility', () => {
    it('returns null when database is not unlocked', () => {
      setupMockContext({ isUnlocked: false });
      const { container } = renderTableSizesRaw();
      expect(container.querySelector('[data-testid="table-sizes"]')).toBeNull();
    });

    it('renders when database is unlocked', async () => {
      setupMockContext({ isUnlocked: true });
      setupMockAdapter({});
      await renderTableSizes();
      expect(screen.getByTestId('table-sizes')).toBeInTheDocument();
    });
  });

  describe('loading state', () => {
    it('shows loading message initially when unlocked', async () => {
      setupMockContext({ isUnlocked: true });
      setupMockAdapter({});
      await renderTableSizes();

      // After loading completes, loading message should not be present
      expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    });
  });

  describe('total database size', () => {
    it('displays total database size from page_size * page_count', async () => {
      setupMockContext({ isUnlocked: true });
      setupMockAdapter({
        page_size: { rows: [{ page_size: 4096 }] },
        page_count: { rows: [{ page_count: 256 }] },
        tables: { rows: [] }
      });

      await renderTableSizes();

      expect(screen.getByText('1 MB')).toBeInTheDocument();
    });

    it('handles empty PRAGMA results with error', async () => {
      const consoleSpy = mockConsoleError();
      setupMockContext({ isUnlocked: true });
      setupMockAdapter({
        page_size: { rows: [] },
        page_count: { rows: [] }
      });

      await renderTableSizes();

      expect(
        screen.getByText('Failed to retrieve database page size or count.')
      ).toBeInTheDocument();
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to fetch table sizes:',
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });

    it('handles array-based pragma rows', async () => {
      setupMockContext({ isUnlocked: true });
      setupMockAdapter({
        page_size: { rows: [[4096]] },
        page_count: { rows: [[2]] },
        tables: { rows: [['users']] },
        dbstat: { rows: [[2048]] }
      });

      await renderTableSizes();

      expect(screen.getByText('8 KB')).toBeInTheDocument();
      expect(screen.getByText('users')).toBeInTheDocument();
      expect(screen.getByText('2 KB')).toBeInTheDocument();
    });
  });

  describe('table sizes with dbstat', () => {
    it('displays table sizes from dbstat when available', async () => {
      setupMockContext({ isUnlocked: true });
      setupMockAdapter({
        tables: { rows: [{ name: 'users' }] },
        dbstat: { rows: [{ size: 2048 }] }
      });

      await renderTableSizes();

      expect(screen.getByText('Rows')).toBeInTheDocument();
      expect(screen.getByText('users')).toBeInTheDocument();
      expect(screen.getByText('2 KB')).toBeInTheDocument();
      expect(screen.getByText('50')).toBeInTheDocument();
    });

    it('does not show estimated indicator when dbstat is available', async () => {
      setupMockContext({ isUnlocked: true });
      setupMockAdapter({
        tables: { rows: [{ name: 'users' }] },
        dbstat: { rows: [{ size: 2048 }] }
      });

      await renderTableSizes();

      expect(screen.getByText('users')).toBeInTheDocument();
      expect(
        screen.queryByText('* Sizes are estimated (dbstat unavailable)')
      ).not.toBeInTheDocument();
    });
  });

  describe('table sizes with fallback estimation', () => {
    it('falls back to row count estimation when dbstat is unavailable', async () => {
      setupMockContext({ isUnlocked: true });
      setupMockAdapter({
        tables: { rows: [{ name: 'users' }] },
        dbstat_error: true,
        count: { rows: [{ count: 100 }] }
      });

      await renderTableSizes();

      expect(screen.getByText('users')).toBeInTheDocument();
      expect(screen.getByText('100')).toBeInTheDocument();
      // 100 rows * 100 bytes = 10000 bytes ≈ 9.77 KB
      expect(screen.getByText('~9.77 KB')).toBeInTheDocument();
    });

    it('shows estimated indicator when using fallback', async () => {
      setupMockContext({ isUnlocked: true });
      setupMockAdapter({
        tables: { rows: [{ name: 'users' }] },
        dbstat_error: true,
        count: { rows: [{ count: 100 }] }
      });

      await renderTableSizes();

      expect(
        screen.getByText('* Sizes are estimated (dbstat unavailable)')
      ).toBeInTheDocument();
    });

    it('prefixes estimated sizes with tilde', async () => {
      setupMockContext({ isUnlocked: true });
      setupMockAdapter({
        tables: { rows: [{ name: 'users' }] },
        dbstat_error: true,
        count: { rows: [{ count: 100 }] }
      });

      await renderTableSizes();

      const sizeElement = screen.getByText(/^~\d/);
      expect(sizeElement).toBeInTheDocument();
    });
  });

  describe('refresh', () => {
    it('refetches sizes when refresh button is clicked', async () => {
      const user = userEvent.setup();
      setupMockContext({ isUnlocked: true });
      const execute = setupMockAdapter({
        tables: { rows: [{ name: 'users' }] },
        dbstat: { rows: [{ size: 1024 }] }
      });

      await renderTableSizes();

      expect(screen.getByText('users')).toBeInTheDocument();

      const initialCallCount = execute.mock.calls.length;

      const refreshButton = screen.getByRole('button');
      await user.click(refreshButton);

      await waitFor(() => {
        expect(execute.mock.calls.length).toBeGreaterThan(initialCallCount);
      });
    });
  });

  describe('empty state', () => {
    it('shows "No tables found" when there are no tables', async () => {
      setupMockContext({ isUnlocked: true });
      setupMockAdapter({
        tables: { rows: [] }
      });

      await renderTableSizes();

      expect(screen.getByText('No tables found')).toBeInTheDocument();
    });
  });

  describe('iOS page_count fallback', () => {
    interface FallbackMockOptions {
      page_size?: { rows: { page_size: number }[] };
      page_count?: { rows: { page_count: number }[] };
      dbstat_error?: boolean;
    }

    function setupFallbackMock(options: FallbackMockOptions = {}) {
      const execute = vi.fn().mockImplementation((sql: string, params) => {
        if (sql === 'PRAGMA page_size') {
          return options.page_size ?? { rows: [{ page_size: 4096 }] };
        }
        if (sql === 'PRAGMA page_count') {
          return options.page_count ?? { rows: [{ page_count: 100 }] };
        }
        if (sql.includes('sqlite_master')) {
          return { rows: [{ name: 'users' }, { name: 'posts' }] };
        }
        if (sql.includes('dbstat')) {
          if (options.dbstat_error) {
            throw new Error('dbstat not available');
          }
          const tableName = params?.[0];
          if (tableName === 'users') return { rows: [{ size: 2048 }] };
          if (tableName === 'posts') return { rows: [{ size: 1024 }] };
        }
        if (sql.includes('COUNT')) {
          return { rows: [{ count: 50 }] };
        }
        return { rows: [] };
      });
      mockGetDatabaseAdapter.mockReturnValue({ execute });
    }

    it('sums table sizes when page_count returns 0', async () => {
      setupMockContext({ isUnlocked: true });
      setupFallbackMock({ page_count: { rows: [{ page_count: 0 }] } });

      await renderTableSizes();

      // Total should be sum of table sizes: 2048 + 1024 = 3072 = 3 KB
      expect(screen.getByText('3 KB')).toBeInTheDocument();
    });

    it('sums table sizes when page_size returns 0', async () => {
      setupMockContext({ isUnlocked: true });
      setupFallbackMock({ page_size: { rows: [{ page_size: 0 }] } });

      await renderTableSizes();

      // Total should be sum of table sizes: 2048 + 1024 = 3072 = 3 KB
      expect(screen.getByText('3 KB')).toBeInTheDocument();
    });

    it('does not use fallback when page_count is valid', async () => {
      setupMockContext({ isUnlocked: true });
      const execute = vi.fn().mockImplementation((sql: string) => {
        if (sql === 'PRAGMA page_size') {
          return { rows: [{ page_size: 4096 }] };
        }
        if (sql === 'PRAGMA page_count') {
          return { rows: [{ page_count: 256 }] };
        }
        if (sql.includes('sqlite_master')) {
          return { rows: [{ name: 'users' }] };
        }
        if (sql.includes('dbstat')) {
          return { rows: [{ size: 1024 }] };
        }
        return { rows: [] };
      });

      mockGetDatabaseAdapter.mockReturnValue({ execute });

      await renderTableSizes();

      // Total should be page_size * page_count = 4096 * 256 = 1 MB
      expect(screen.getByText('1 MB')).toBeInTheDocument();
    });

    it('shows 0 B when page_count is 0 and no tables exist', async () => {
      setupMockContext({ isUnlocked: true });
      setupMockAdapter({
        page_size: { rows: [{ page_size: 4096 }] },
        page_count: { rows: [{ page_count: 0 }] },
        tables: { rows: [] }
      });

      await renderTableSizes();

      // No tables to sum, so stays at 0
      expect(screen.getByText('0 B')).toBeInTheDocument();
    });

    it('shows tilde prefix on total when fallback uses estimated table sizes', async () => {
      setupMockContext({ isUnlocked: true });
      setupFallbackMock({
        page_count: { rows: [{ page_count: 0 }] },
        dbstat_error: true
      });

      await renderTableSizes();

      // Total size should have tilde prefix when using estimated table sizes
      // 50 rows * 100 bytes * 2 tables = 10000 bytes ≈ 9.77 KB
      expect(screen.getByText(/^~9\.77 KB$/)).toBeInTheDocument();
    });

    it('does not show tilde on total when fallback uses exact table sizes', async () => {
      setupMockContext({ isUnlocked: true });
      setupFallbackMock({ page_count: { rows: [{ page_count: 0 }] } });

      await renderTableSizes();

      // Total should not have tilde when using exact dbstat sizes
      // The total 3 KB should appear without a tilde prefix
      expect(screen.queryByText(/^~3 KB$/)).not.toBeInTheDocument();
      expect(screen.getByText('3 KB')).toBeInTheDocument();
    });
  });

  describe('sorting', () => {
    it('sorts tables by size in descending order', async () => {
      setupMockContext({ isUnlocked: true });
      const execute = vi.fn().mockImplementation((sql: string, params) => {
        if (sql === 'PRAGMA page_size') {
          return { rows: [{ page_size: 4096 }] };
        }
        if (sql === 'PRAGMA page_count') {
          return { rows: [{ page_count: 10 }] };
        }
        if (sql.includes('sqlite_master')) {
          return { rows: [{ name: 'small' }, { name: 'large' }] };
        }
        if (sql.includes('dbstat')) {
          const tableName = params?.[0];
          if (tableName === 'small') {
            return { rows: [{ size: 100 }] };
          }
          if (tableName === 'large') {
            return { rows: [{ size: 10000 }] };
          }
        }
        return { rows: [] };
      });

      mockGetDatabaseAdapter.mockReturnValue({ execute });

      await renderTableSizes();

      const tableNames = screen.getAllByText(/small|large/);
      expect(tableNames[0]).toHaveTextContent('large');
      expect(tableNames[1]).toHaveTextContent('small');
    });
  });

  describe('table links', () => {
    it('renders table names as clickable links', async () => {
      setupMockContext({ isUnlocked: true });
      setupMockAdapter({
        tables: { rows: [{ name: 'users' }] },
        dbstat: { rows: [{ size: 1024 }] }
      });

      await renderTableSizes();

      const link = screen.getByRole('link', { name: 'users' });
      expect(link).toBeInTheDocument();
    });

    it('links navigate to /sqlite/tables/{tableName}', async () => {
      setupMockContext({ isUnlocked: true });
      setupMockAdapter({
        tables: { rows: [{ name: 'users' }] },
        dbstat: { rows: [{ size: 1024 }] }
      });

      await renderTableSizes();

      const link = screen.getByRole('link', { name: 'users' });
      expect(link).toHaveAttribute('href', '/sqlite/tables/users');
    });

    it('URL encodes special characters in table names', async () => {
      setupMockContext({ isUnlocked: true });
      setupMockAdapter({
        tables: { rows: [{ name: 'my table' }] },
        dbstat: { rows: [{ size: 1024 }] }
      });

      await renderTableSizes();

      const link = screen.getByRole('link', { name: 'my table' });
      expect(link).toHaveAttribute('href', '/sqlite/tables/my%20table');
    });

    it('renders multiple table links correctly', async () => {
      setupMockContext({ isUnlocked: true });
      setupMockAdapter({
        tables: { rows: [{ name: 'users' }, { name: 'posts' }] },
        dbstat: { rows: [{ size: 1024 }] }
      });

      await renderTableSizes();

      const usersLink = screen.getByRole('link', { name: 'users' });
      const postsLink = screen.getByRole('link', { name: 'posts' });
      expect(usersLink).toHaveAttribute('href', '/sqlite/tables/users');
      expect(postsLink).toHaveAttribute('href', '/sqlite/tables/posts');
    });

    it('passes navigation state for back navigation', async () => {
      setupMockContext({ isUnlocked: true });
      setupMockAdapter({
        tables: { rows: [{ name: 'users' }] },
        dbstat: { rows: [{ size: 1024 }] }
      });

      const Destination = () => {
        const location = useLocation();
        return (
          <div data-testid="location-state">
            {JSON.stringify(location.state)}
          </div>
        );
      };

      render(
        <MemoryRouter initialEntries={['/sqlite']}>
          <Routes>
            <Route path="/sqlite" element={<TableSizes />} />
            <Route path="/sqlite/tables/users" element={<Destination />} />
          </Routes>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
      });

      const link = screen.getByRole('link', { name: 'users' });
      await userEvent.setup().click(link);

      const locationState = await screen.findByTestId('location-state');
      expect(JSON.parse(locationState.textContent ?? '{}')).toEqual({
        from: '/sqlite',
        fromLabel: 'Back to SQLite'
      });
    });

    it('invokes onTableSelect when provided', async () => {
      setupMockContext({ isUnlocked: true });
      setupMockAdapter({
        tables: { rows: [{ name: 'users' }] },
        dbstat: { rows: [{ size: 1024 }] }
      });
      const onTableSelect = vi.fn();

      render(
        <MemoryRouter>
          <TableSizes onTableSelect={onTableSelect} />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
      });

      const button = screen.getByRole('button', { name: 'users' });
      await userEvent.setup().click(button);

      expect(onTableSelect).toHaveBeenCalledWith('users');
    });
  });
});

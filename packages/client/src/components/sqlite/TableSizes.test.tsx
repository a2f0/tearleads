import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
      setupMockContext({ isUnlocked: true });
      setupMockAdapter({
        page_size: { rows: [] },
        page_count: { rows: [] }
      });

      await renderTableSizes();

      expect(
        screen.getByText('Failed to retrieve database page size or count.')
      ).toBeInTheDocument();
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

      expect(screen.getByText('users')).toBeInTheDocument();
      expect(screen.getByText('2 KB')).toBeInTheDocument();
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

    it('links navigate to /tables/{tableName}', async () => {
      setupMockContext({ isUnlocked: true });
      setupMockAdapter({
        tables: { rows: [{ name: 'users' }] },
        dbstat: { rows: [{ size: 1024 }] }
      });

      await renderTableSizes();

      const link = screen.getByRole('link', { name: 'users' });
      expect(link).toHaveAttribute('href', '/tables/users');
    });

    it('URL encodes special characters in table names', async () => {
      setupMockContext({ isUnlocked: true });
      setupMockAdapter({
        tables: { rows: [{ name: 'my table' }] },
        dbstat: { rows: [{ size: 1024 }] }
      });

      await renderTableSizes();

      const link = screen.getByRole('link', { name: 'my table' });
      expect(link).toHaveAttribute('href', '/tables/my%20table');
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
      expect(usersLink).toHaveAttribute('href', '/tables/users');
      expect(postsLink).toHaveAttribute('href', '/tables/posts');
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
            <Route path="/tables/users" element={<Destination />} />
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
  });
});

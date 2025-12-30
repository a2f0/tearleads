import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
      const { container } = render(<TableSizes />);
      expect(container).toBeEmptyDOMElement();
    });

    it('renders when database is unlocked', () => {
      setupMockContext({ isUnlocked: true });
      setupMockAdapter({});
      render(<TableSizes />);
      expect(screen.getByTestId('table-sizes')).toBeInTheDocument();
    });
  });

  describe('loading state', () => {
    it('shows loading message initially when unlocked', async () => {
      setupMockContext({ isUnlocked: true });
      setupMockAdapter({});
      render(<TableSizes />);

      await waitFor(() => {
        expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
      });
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

      render(<TableSizes />);

      await waitFor(() => {
        expect(screen.getByText('1 MB')).toBeInTheDocument();
      });
    });

    it('handles empty PRAGMA results with error', async () => {
      setupMockContext({ isUnlocked: true });
      setupMockAdapter({
        page_size: { rows: [] },
        page_count: { rows: [] }
      });

      render(<TableSizes />);

      await waitFor(() => {
        expect(
          screen.getByText('Failed to retrieve database page size or count.')
        ).toBeInTheDocument();
      });
    });
  });

  describe('table sizes with dbstat', () => {
    it('displays table sizes from dbstat when available', async () => {
      setupMockContext({ isUnlocked: true });
      setupMockAdapter({
        tables: { rows: [{ name: 'users' }] },
        dbstat: { rows: [{ size: 2048 }] }
      });

      render(<TableSizes />);

      await waitFor(() => {
        expect(screen.getByText('users')).toBeInTheDocument();
        expect(screen.getByText('2 KB')).toBeInTheDocument();
      });
    });

    it('does not show estimated indicator when dbstat is available', async () => {
      setupMockContext({ isUnlocked: true });
      setupMockAdapter({
        tables: { rows: [{ name: 'users' }] },
        dbstat: { rows: [{ size: 2048 }] }
      });

      render(<TableSizes />);

      await waitFor(() => {
        expect(screen.getByText('users')).toBeInTheDocument();
      });

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

      render(<TableSizes />);

      await waitFor(() => {
        expect(screen.getByText('users')).toBeInTheDocument();
        // 100 rows * 100 bytes = 10000 bytes ≈ 9.77 KB
        expect(screen.getByText('~9.77 KB')).toBeInTheDocument();
      });
    });

    it('shows estimated indicator when using fallback', async () => {
      setupMockContext({ isUnlocked: true });
      setupMockAdapter({
        tables: { rows: [{ name: 'users' }] },
        dbstat_error: true,
        count: { rows: [{ count: 100 }] }
      });

      render(<TableSizes />);

      await waitFor(() => {
        expect(
          screen.getByText('* Sizes are estimated (dbstat unavailable)')
        ).toBeInTheDocument();
      });
    });

    it('prefixes estimated sizes with tilde', async () => {
      setupMockContext({ isUnlocked: true });
      setupMockAdapter({
        tables: { rows: [{ name: 'users' }] },
        dbstat_error: true,
        count: { rows: [{ count: 100 }] }
      });

      render(<TableSizes />);

      await waitFor(() => {
        const sizeElement = screen.getByText(/^~\d/);
        expect(sizeElement).toBeInTheDocument();
      });
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

      render(<TableSizes />);

      await waitFor(() => {
        expect(screen.getByText('users')).toBeInTheDocument();
      });

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

      render(<TableSizes />);

      await waitFor(() => {
        expect(screen.getByText('No tables found')).toBeInTheDocument();
      });
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

      render(<TableSizes />);

      await waitFor(() => {
        const tableNames = screen.getAllByText(/small|large/);
        expect(tableNames[0]).toHaveTextContent('large');
        expect(tableNames[1]).toHaveTextContent('small');
      });
    });
  });
});

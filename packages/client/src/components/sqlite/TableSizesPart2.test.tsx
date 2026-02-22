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

  describe('table ordering', () => {
    it('displays tables in the order returned by the query (alphabetically)', async () => {
      setupMockContext({ isUnlocked: true });
      const execute = vi.fn().mockImplementation((sql: string, params) => {
        if (sql === 'PRAGMA page_size') {
          return { rows: [{ page_size: 4096 }] };
        }
        if (sql === 'PRAGMA page_count') {
          return { rows: [{ page_count: 10 }] };
        }
        if (sql.includes('sqlite_master')) {
          // SQL query uses ORDER BY name, so return in alphabetical order
          return { rows: [{ name: 'alpha' }, { name: 'zebra' }] };
        }
        if (sql.includes('dbstat')) {
          const tableName = params?.[0];
          if (tableName === 'alpha') {
            return { rows: [{ size: 100 }] };
          }
          if (tableName === 'zebra') {
            return { rows: [{ size: 10000 }] };
          }
        }
        return { rows: [] };
      });

      mockGetDatabaseAdapter.mockReturnValue({ execute });

      await renderTableSizes();

      // Tables should be displayed in the order returned by the query
      const tableNames = screen.getAllByText(/alpha|zebra/);
      expect(tableNames[0]).toHaveTextContent('alpha');
      expect(tableNames[1]).toHaveTextContent('zebra');
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

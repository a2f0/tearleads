import {
  act,
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps, FC } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockConsoleError } from '@/test/consoleMocks';
import { TableRows } from './TableRows';

// Mock lucide-react icons to add testids
vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('lucide-react')>();
  const MockIcon =
    (testId: string): FC<ComponentProps<'svg'>> =>
    (props) => <svg {...props} data-testid={testId} />;
  return {
    ...actual,
    ArrowUp: MockIcon('arrow-up'),
    ArrowDown: MockIcon('arrow-down'),
    ArrowUpDown: MockIcon('arrow-up-down')
  };
});

// Mock useVirtualizer to simplify testing (virtualizer doesn't work in jsdom)
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: vi.fn(({ count }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, i) => ({
        index: i,
        start: i * 40,
        size: 40,
        key: i
      })),
    getTotalSize: () => count * 40,
    measureElement: vi.fn()
  }))
}));

// Mock database adapter
const mockExecute = vi.fn();
vi.mock('@/db', () => ({
  getDatabaseAdapter: vi.fn(() => ({
    execute: mockExecute
  }))
}));

// Mock database context
const mockUseDatabaseContext = vi.fn();
vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => mockUseDatabaseContext()
}));

async function renderTableRows(tableName = 'test_table') {
  const result = render(
    <MemoryRouter initialEntries={[`/sqlite/tables/${tableName}`]}>
      <Routes>
        <Route path="/sqlite/tables/:tableName" element={<TableRows />} />
      </Routes>
    </MemoryRouter>
  );
  // Flush the setTimeout(fn, 0) used for instance-aware fetching
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  // Flush requestAnimationFrame used by initialLoadCompleteRef
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
  return result;
}

// Helper to simulate user scroll on the virtual scroll container
async function simulateScroll(container: HTMLElement) {
  // Find the scroll container by data-testid
  const scrollContainer = container.querySelector(
    '[data-testid="scroll-container"]'
  );
  if (scrollContainer) {
    // Dispatch scroll event
    await act(async () => {
      fireEvent.scroll(scrollContainer);
      // Give effect time to run
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

describe('TableRows', () => {

  const mockColumns = [
    {
      cid: 0,
      name: 'id',
      type: 'INTEGER',
      notnull: 0,
      dflt_value: null,
      pk: 1
    },
    { cid: 1, name: 'name', type: 'TEXT', notnull: 0, dflt_value: null, pk: 0 },
    {
      cid: 2,
      name: 'age',
      type: 'INTEGER',
      notnull: 0,
      dflt_value: null,
      pk: 0
    }
  ];

  const mockRows = [
    { id: 1, name: 'Alice', age: 30 },
    { id: 2, name: 'Bob', age: 25 },
    { id: 3, name: 'Charlie', age: 35 }
  ];

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock database context
    mockUseDatabaseContext.mockReturnValue({
      isUnlocked: true,
      isLoading: false,
      currentInstanceId: 'test-instance'
    });

    // Default mock responses
    mockExecute.mockImplementation((query: string) => {
      if (query.includes('sqlite_master')) {
        return Promise.resolve({ rows: [{ name: 'test_table' }] });
      }
      if (query.includes('PRAGMA table_info')) {
        return Promise.resolve({ rows: mockColumns });
      }
      if (query.includes('COUNT(*)')) {
        // Return count equal to mockRows length so hasMore=false (no pagination)
        return Promise.resolve({ rows: [{ count: mockRows.length }] });
      }
      if (query.includes('SELECT *')) {
        return Promise.resolve({ rows: mockRows });
      }
      return Promise.resolve({ rows: [] });
    });
  });

  describe('truncate table', () => {
    it('shows Truncate button initially', async () => {
      await renderTableRows();

      await waitFor(() => {
        const truncateButton = screen.getByTestId('truncate-button');
        expect(truncateButton).toBeInTheDocument();
        expect(truncateButton).toHaveTextContent('Truncate');
      });
    });

    it('shows Confirm on first click and executes DELETE on second click', async () => {
      const user = userEvent.setup();
      await renderTableRows();

      await waitFor(() => {
        expect(screen.getByTestId('truncate-button')).toBeInTheDocument();
      });

      const truncateButton = screen.getByTestId('truncate-button');

      // First click - enter confirm mode
      await user.click(truncateButton);
      expect(truncateButton).toHaveTextContent('Confirm');

      // Second click - execute truncate
      await user.click(truncateButton);

      await waitFor(() => {
        // Should have called DELETE FROM
        expect(mockExecute).toHaveBeenCalledWith(
          'DELETE FROM "test_table"',
          []
        );
        // Should have reset the sequence
        expect(mockExecute).toHaveBeenCalledWith(
          'DELETE FROM sqlite_sequence WHERE name = ?',
          ['test_table']
        );
      });

      // Should reset button text after successful truncate
      await waitFor(() => {
        expect(truncateButton).toHaveTextContent('Truncate');
      });
    });

    it('handles truncate when sqlite_sequence does not exist', async () => {
      const user = userEvent.setup();
      mockExecute.mockImplementation((query: string) => {
        if (query.includes('sqlite_master')) {
          return Promise.resolve({ rows: [{ name: 'test_table' }] });
        }
        if (query.includes('PRAGMA table_info')) {
          return Promise.resolve({ rows: mockColumns });
        }
        if (query.includes('DELETE FROM sqlite_sequence')) {
          return Promise.reject(new Error('no such table: sqlite_sequence'));
        }
        if (query.includes('DELETE FROM "test_table"')) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      });

      await renderTableRows();

      await waitFor(() => {
        expect(screen.getByTestId('truncate-button')).toBeInTheDocument();
      });

      const truncateButton = screen.getByTestId('truncate-button');

      // First click - enter confirm mode
      await user.click(truncateButton);
      // Second click - execute truncate
      await user.click(truncateButton);

      // Should succeed even with sqlite_sequence error
      await waitFor(() => {
        expect(truncateButton).toHaveTextContent('Truncate');
      });
    });

    it('shows error when truncate fails', async () => {
      const user = userEvent.setup();
      const consoleSpy = mockConsoleError();
      mockExecute.mockImplementation((query: string) => {
        if (query.includes('sqlite_master')) {
          return Promise.resolve({ rows: [{ name: 'test_table' }] });
        }
        if (query.includes('PRAGMA table_info')) {
          return Promise.resolve({ rows: mockColumns });
        }
        if (query.includes('COUNT(*)')) {
          return Promise.resolve({ rows: [{ count: 3 }] });
        }
        if (query.includes('DELETE FROM "test_table"')) {
          return Promise.reject(new Error('truncate failed'));
        }
        if (query.includes('SELECT *')) {
          return Promise.resolve({ rows: mockRows });
        }
        return Promise.resolve({ rows: [] });
      });

      await renderTableRows();

      await waitFor(() => {
        expect(screen.getByTestId('truncate-button')).toBeInTheDocument();
      });

      const truncateButton = screen.getByTestId('truncate-button');

      // First click - enter confirm mode
      await user.click(truncateButton);

      // Wait for confirm state
      await waitFor(() => {
        expect(truncateButton).toHaveTextContent('Confirm');
      });

      // Second click - execute truncate (which will fail)
      await user.click(truncateButton);

      await waitFor(() => {
        expect(screen.getByText('truncate failed')).toBeInTheDocument();
      });
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to truncate table:',
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });
  });

  describe('document view', () => {
    it('toggles document view when button is clicked', async () => {
      const user = userEvent.setup();
      await renderTableRows();

      await waitFor(() => {
        expect(screen.getByText('Alice')).toBeInTheDocument();
      });

      // Click the document view toggle button (Braces icon)
      const toggleButton = screen.getByTitle('Toggle document view');
      await user.click(toggleButton);

      // Should render as JSON
      await waitFor(() => {
        expect(
          screen.getByText(/"name": "Alice"/, { exact: false })
        ).toBeInTheDocument();
      });
    });

    it('shows loader row when loading more in document view', async () => {
      const user = userEvent.setup();
      let fetchCount = 0;
      mockExecute.mockImplementation((query: string) => {
        if (query.includes('sqlite_master')) {
          return Promise.resolve({ rows: [{ name: 'test_table' }] });
        }
        if (query.includes('PRAGMA table_info')) {
          return Promise.resolve({ rows: mockColumns });
        }
        if (query.includes('COUNT(*)')) {
          return Promise.resolve({ rows: [{ count: 100 }] });
        }
        if (query.includes('SELECT *')) {
          fetchCount++;
          // Return PAGE_SIZE (50) rows to trigger hasMore
          if (fetchCount === 1) {
            const rows = Array.from({ length: 50 }, (_, i) => ({
              id: i + 1,
              name: `User ${i + 1}`,
              age: 20 + i
            }));
            return Promise.resolve({ rows });
          }
          // Subsequent fetches return rows with unique IDs based on fetch count
          const startId = 50 + (fetchCount - 1) * 10;
          return Promise.resolve({
            rows: [{ id: startId, name: `Extra User ${fetchCount}`, age: 50 }]
          });
        }
        return Promise.resolve({ rows: [] });
      });

      const { container } = await renderTableRows();

      await waitFor(() => {
        expect(screen.getByText('User 1')).toBeInTheDocument();
      });

      // Switch to document view
      const toggleButton = screen.getByTitle('Toggle document view');
      await user.click(toggleButton);

      // Should render as JSON in document view
      await waitFor(() => {
        expect(
          screen.getByText(/"name": "User 1"/, { exact: false })
        ).toBeInTheDocument();
      });

      // Simulate user scroll to enable load-more
      await simulateScroll(container);

      // The virtualizer mock triggers load-more after scroll
      await waitFor(() => {
        expect(fetchCount).toBeGreaterThanOrEqual(2);
      });
    });

    it('shows empty state in document view', async () => {
      const user = userEvent.setup();
      mockExecute.mockImplementation((query: string) => {
        if (query.includes('sqlite_master')) {
          return Promise.resolve({ rows: [{ name: 'test_table' }] });
        }
        if (query.includes('PRAGMA table_info')) {
          return Promise.resolve({ rows: mockColumns });
        }
        return Promise.resolve({ rows: [] });
      });

      await renderTableRows();

      await waitFor(() => {
        // VirtualListStatus shows "0 rows" format
        expect(screen.getByText('0 rows')).toBeInTheDocument();
      });

      const toggleButton = screen.getByTitle('Toggle document view');
      await user.click(toggleButton);

      await waitFor(() => {
        expect(screen.getByText('No rows in this table')).toBeInTheDocument();
      });
    });
  });
});

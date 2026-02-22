import {
  act,
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react';
import type { ComponentProps, FC } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

  describe('infinite scroll', () => {
    it('loads more rows when scrolling near the end', async () => {
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
          // Return PAGE_SIZE (50) rows on first fetch to trigger hasMore
          if (fetchCount === 1) {
            const rows = Array.from({ length: 50 }, (_, i) => ({
              id: i + 1,
              name: `User ${i + 1}`,
              age: 20 + i
            }));
            return Promise.resolve({ rows });
          }
          // Return rows with unique IDs on subsequent fetches
          const startId = 50 + (fetchCount - 1) * 10;
          return Promise.resolve({
            rows: [{ id: startId, name: `Extra User ${fetchCount}`, age: 50 }]
          });
        }
        return Promise.resolve({ rows: [] });
      });

      const { container } = await renderTableRows();

      // Initial fetch should have been called
      await waitFor(() => {
        expect(
          mockExecute.mock.calls.some(
            (call) =>
              call[0].includes('SELECT *') && call[0].includes('OFFSET 0')
          )
        ).toBe(true);
      });

      // Simulate user scroll to enable load-more
      await simulateScroll(container);

      // After scroll, load-more triggers and fetches the next page
      await waitFor(() => {
        // Should have called fetchTableData(false) which uses OFFSET > 0
        expect(
          mockExecute.mock.calls.some(
            (call) =>
              call[0].includes('SELECT *') && call[0].includes('OFFSET 50')
          )
        ).toBe(true);
      });
    });

    it('stops loading when all rows have been fetched (offset >= totalCount)', async () => {
      let fetchCount = 0;
      const TOTAL_COUNT = 75; // Less than 2 full pages

      mockExecute.mockImplementation((query: string) => {
        if (query.includes('sqlite_master')) {
          return Promise.resolve({ rows: [{ name: 'test_table' }] });
        }
        if (query.includes('PRAGMA table_info')) {
          return Promise.resolve({ rows: mockColumns });
        }
        if (query.includes('COUNT(*)')) {
          return Promise.resolve({ rows: [{ count: TOTAL_COUNT }] });
        }
        if (query.includes('SELECT *')) {
          fetchCount++;
          if (fetchCount === 1) {
            // First page: 50 rows (offset 0-49)
            const rows = Array.from({ length: 50 }, (_, i) => ({
              id: i + 1,
              name: `User ${i + 1}`,
              age: 20 + i
            }));
            return Promise.resolve({ rows });
          }
          if (fetchCount === 2) {
            // Second page: 25 rows (offset 50-74)
            const rows = Array.from({ length: 25 }, (_, i) => ({
              id: 51 + i,
              name: `User ${51 + i}`,
              age: 70 + i
            }));
            return Promise.resolve({ rows });
          }
          // Should not reach here - no third fetch expected
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      });

      const { container } = await renderTableRows();

      // Wait for initial fetch
      await waitFor(() => {
        expect(fetchCount).toBe(1);
      });

      // Simulate user scroll to enable load-more
      await simulateScroll(container);

      // Wait for load-more to complete
      await waitFor(() => {
        expect(fetchCount).toBe(2);
      });

      // Simulate another scroll - should NOT trigger third fetch since all data loaded
      await simulateScroll(container);

      // Wait a bit to ensure no additional fetches occur
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });

      // Verify no third fetch was made (pagination stopped at totalCount)
      expect(fetchCount).toBe(2);

      // Verify the status shows all rows loaded (75 total, 75 loaded)
      await waitFor(() => {
        expect(screen.getByText(/75 rows/)).toBeInTheDocument();
      });
    });
  });

  describe('loading states', () => {
    it('shows loading state when database is locked', async () => {
      mockUseDatabaseContext.mockReturnValue({
        isUnlocked: false,
        isLoading: false,
        currentInstanceId: 'test-instance'
      });

      await renderTableRows();

      // Should not show table data when locked
      await waitFor(() => {
        expect(screen.queryByText('Alice')).not.toBeInTheDocument();
      });
    });

    it('shows table view empty state when no rows', async () => {
      mockExecute.mockImplementation((query: string) => {
        if (query.includes('sqlite_master')) {
          return Promise.resolve({ rows: [{ name: 'test_table' }] });
        }
        if (query.includes('PRAGMA table_info')) {
          return Promise.resolve({ rows: mockColumns });
        }
        if (query.includes('COUNT(*)')) {
          return Promise.resolve({ rows: [{ count: 0 }] });
        }
        return Promise.resolve({ rows: [] });
      });

      await renderTableRows();

      await waitFor(() => {
        expect(screen.getByText('No rows in this table')).toBeInTheDocument();
      });
    });
  });

  describe('instance switching', () => {
    it('refetches table rows when instance changes', async () => {
      const { rerender } = await renderTableRows();

      await waitFor(() => {
        expect(screen.getByText('Alice')).toBeInTheDocument();
      });

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
        <MemoryRouter initialEntries={['/sqlite/tables/test_table']}>
          <Routes>
            <Route path="/sqlite/tables/:tableName" element={<TableRows />} />
          </Routes>
        </MemoryRouter>
      );

      // Flush the setTimeout for instance-aware fetching
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      // Verify that table rows were fetched again
      await waitFor(() => {
        expect(mockExecute).toHaveBeenCalled();
      });
    });
  });
});

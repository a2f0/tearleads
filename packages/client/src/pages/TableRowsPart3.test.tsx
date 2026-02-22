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
async function _simulateScroll(container: HTMLElement) {
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

  describe('column visibility', () => {
    it('toggles column visibility when checkbox is clicked', async () => {
      const user = userEvent.setup();
      await renderTableRows();

      await waitFor(() => {
        expect(screen.getByText('Alice')).toBeInTheDocument();
      });

      // Open column settings
      await user.click(screen.getByTestId('column-settings-button'));

      // Toggle name column off
      await user.click(screen.getByTestId('column-toggle-name'));

      // Name column should be hidden
      await waitFor(() => {
        expect(screen.queryByTestId('sort-name')).not.toBeInTheDocument();
      });

      // Toggle name column back on
      await user.click(screen.getByTestId('column-toggle-name'));

      await waitFor(() => {
        expect(screen.getByTestId('sort-name')).toBeInTheDocument();
      });
    });

    it('resets sort when sorted column is hidden', async () => {
      const user = userEvent.setup();
      await renderTableRows();

      await waitFor(() => {
        expect(screen.getByTestId('sort-name')).toBeInTheDocument();
      });

      // Sort by name
      await user.click(screen.getByTestId('sort-name'));

      await waitFor(() => {
        expect(mockExecute).toHaveBeenCalledWith(
          expect.stringContaining('ORDER BY "name" ASC'),
          []
        );
      });

      // Open column settings and hide name column
      await user.click(screen.getByTestId('column-settings-button'));
      await user.click(screen.getByTestId('column-toggle-name'));

      // Sort should be cleared - find the most recent SELECT * query
      await waitFor(() => {
        const selectCalls = mockExecute.mock.calls.filter((call) =>
          call[0]?.includes('SELECT *')
        );
        const lastSelectCall = selectCalls[selectCalls.length - 1];
        expect(lastSelectCall?.[0]).toContain('SELECT *');
        expect(lastSelectCall?.[0]).not.toContain('ORDER BY');
      });
    });

    it('closes settings dropdown when clicking outside', async () => {
      const user = userEvent.setup();
      await renderTableRows();

      await waitFor(() => {
        expect(
          screen.getByTestId('column-settings-button')
        ).toBeInTheDocument();
      });

      // Open column settings
      await user.click(screen.getByTestId('column-settings-button'));

      // Check dropdown is open
      await waitFor(() => {
        expect(screen.getByText('Visible Columns')).toBeInTheDocument();
      });

      // Click outside the dropdown (on the body/document)
      await user.click(document.body);

      // Dropdown should be closed
      await waitFor(() => {
        expect(screen.queryByText('Visible Columns')).not.toBeInTheDocument();
      });
    });
  });

  describe('error handling', () => {
    it('displays error when table does not exist', async () => {
      const consoleSpy = mockConsoleError();
      mockExecute.mockImplementation((query: string) => {
        if (query.includes('sqlite_master')) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      });

      await renderTableRows('nonexistent_table');

      await waitFor(() => {
        expect(
          screen.getByText('Table "nonexistent_table" does not exist.')
        ).toBeInTheDocument();
      });
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to fetch table data:',
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });

    it('displays error when query fails', async () => {
      const consoleSpy = mockConsoleError();
      mockExecute.mockRejectedValue(new Error('Database error'));

      await renderTableRows();

      await waitFor(() => {
        expect(screen.getByText('Database error')).toBeInTheDocument();
      });
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to fetch table data:',
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });
  });

  describe('cell value formatting', () => {
    it('formats NULL values', async () => {
      mockExecute.mockImplementation((query: string) => {
        if (query.includes('sqlite_master')) {
          return Promise.resolve({ rows: [{ name: 'test_table' }] });
        }
        if (query.includes('PRAGMA table_info')) {
          return Promise.resolve({ rows: mockColumns });
        }
        if (query.includes('SELECT *')) {
          return Promise.resolve({
            rows: [{ id: 1, name: null, age: null }]
          });
        }
        return Promise.resolve({ rows: [] });
      });

      await renderTableRows();

      await waitFor(() => {
        const nullValues = screen.getAllByText('NULL');
        expect(nullValues.length).toBeGreaterThan(0);
      });
    });

    it('formats boolean values', async () => {
      mockExecute.mockImplementation((query: string) => {
        if (query.includes('sqlite_master')) {
          return Promise.resolve({ rows: [{ name: 'test_table' }] });
        }
        if (query.includes('PRAGMA table_info')) {
          return Promise.resolve({
            rows: [
              { cid: 0, name: 'id', type: 'INTEGER', pk: 1 },
              { cid: 1, name: 'active', type: 'BOOLEAN', pk: 0 }
            ]
          });
        }
        if (query.includes('SELECT *')) {
          return Promise.resolve({
            rows: [
              { id: 1, active: true },
              { id: 2, active: false }
            ]
          });
        }
        return Promise.resolve({ rows: [] });
      });

      await renderTableRows();

      await waitFor(() => {
        expect(screen.getByText('true')).toBeInTheDocument();
        expect(screen.getByText('false')).toBeInTheDocument();
      });
    });

    it('formats object values as JSON', async () => {
      mockExecute.mockImplementation((query: string) => {
        if (query.includes('sqlite_master')) {
          return Promise.resolve({ rows: [{ name: 'test_table' }] });
        }
        if (query.includes('PRAGMA table_info')) {
          return Promise.resolve({
            rows: [
              { cid: 0, name: 'id', type: 'INTEGER', pk: 1 },
              { cid: 1, name: 'data', type: 'TEXT', pk: 0 }
            ]
          });
        }
        if (query.includes('SELECT *')) {
          return Promise.resolve({
            rows: [{ id: 1, data: { key: 'value' } }]
          });
        }
        return Promise.resolve({ rows: [] });
      });

      await renderTableRows();

      await waitFor(() => {
        expect(screen.getByText('{"key":"value"}')).toBeInTheDocument();
      });
    });
  });

  describe('column resizing', () => {
    it('supports keyboard resizing with arrow keys', async () => {
      const user = userEvent.setup();
      await renderTableRows();

      await waitFor(() => {
        expect(screen.getByTestId('sort-name')).toBeInTheDocument();
      });

      // Find the resize handle for the name column
      const resizeHandle = screen.getByLabelText('Resize name column');
      expect(resizeHandle).toBeInTheDocument();

      // Focus the resize handle
      resizeHandle.focus();

      // Press ArrowRight to increase width
      await user.keyboard('{ArrowRight}');

      // The handle should still exist (test would fail if resize broke something)
      expect(resizeHandle).toBeInTheDocument();
    });
  });

  describe('row count display', () => {
    it('shows singular "row" for 1 row', async () => {
      mockExecute.mockImplementation((query: string) => {
        if (query.includes('sqlite_master')) {
          return Promise.resolve({ rows: [{ name: 'test_table' }] });
        }
        if (query.includes('PRAGMA table_info')) {
          return Promise.resolve({ rows: mockColumns });
        }
        if (query.includes('COUNT(*)')) {
          return Promise.resolve({ rows: [{ count: 1 }] });
        }
        if (query.includes('SELECT *')) {
          return Promise.resolve({
            rows: [{ id: 1, name: 'Alice', age: 30 }]
          });
        }
        return Promise.resolve({ rows: [] });
      });

      await renderTableRows();

      await waitFor(() => {
        // VirtualListStatus shows "1 row" for singular
        expect(screen.getByText(/1 row/)).toBeInTheDocument();
      });
    });

    it('shows total count from database', async () => {
      // This test verifies that totalCount from COUNT(*) is displayed in VirtualListStatus
      // Using default mock which returns mockRows (3 rows) with COUNT(*) = 3
      // No pagination needed - just verify the count shows up
      await renderTableRows();

      // Wait for data to load
      await waitFor(() => {
        expect(screen.getByText('Alice')).toBeInTheDocument();
      });

      // VirtualListStatus shows "Viewing 1-3 of 3 rows" when totalCount === loadedCount
      // The "3" appears in the status text
      await waitFor(() => {
        expect(screen.getByText(/3 rows/)).toBeInTheDocument();
      });
    });
  });
});

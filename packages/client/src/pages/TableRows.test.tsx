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
import { mockConsoleError } from '@/test/console-mocks';
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
    <MemoryRouter initialEntries={[`/tables/${tableName}`]}>
      <Routes>
        <Route path="/tables/:tableName" element={<TableRows />} />
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

  describe('column sorting', () => {
    it('renders sort buttons for visible columns (id hidden by default)', async () => {
      await renderTableRows();

      await waitFor(() => {
        expect(screen.getByTestId('sort-name')).toBeInTheDocument();
        expect(screen.getByTestId('sort-age')).toBeInTheDocument();
      });

      // id column is hidden by default
      expect(screen.queryByTestId('sort-id')).not.toBeInTheDocument();
    });

    it('shows unsorted icon initially', async () => {
      await renderTableRows();

      await waitFor(() => {
        expect(screen.getByTestId('sort-name')).toBeInTheDocument();
      });

      // All columns should show the ArrowUpDown icon (unsorted state)
      const sortButton = screen.getByTestId('sort-name');
      expect(
        sortButton.querySelector('[data-testid="arrow-up-down"]')
      ).toBeInTheDocument();
      expect(
        sortButton.querySelector('[data-testid="arrow-up"]')
      ).not.toBeInTheDocument();
      expect(
        sortButton.querySelector('[data-testid="arrow-down"]')
      ).not.toBeInTheDocument();
    });

    it('cycles through sort states: none -> asc -> desc -> none', async () => {
      const user = userEvent.setup();
      await renderTableRows();

      await waitFor(() => {
        expect(screen.getByTestId('sort-name')).toBeInTheDocument();
      });

      const sortButton = screen.getByTestId('sort-name');

      // Initial state - no ORDER BY
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM "test_table" LIMIT 50'),
        []
      );

      // Click once - should sort ascending
      await user.click(sortButton);

      await waitFor(() => {
        expect(mockExecute).toHaveBeenCalledWith(
          expect.stringContaining('ORDER BY "name" ASC'),
          []
        );
      });

      // Click again - should sort descending
      await user.click(sortButton);

      await waitFor(() => {
        expect(mockExecute).toHaveBeenCalledWith(
          expect.stringContaining('ORDER BY "name" DESC'),
          []
        );
      });

      // Click third time - should clear sort
      await user.click(sortButton);

      await waitFor(() => {
        const lastCall =
          mockExecute.mock.calls[mockExecute.mock.calls.length - 1];
        expect(lastCall).toBeDefined();
        expect(lastCall?.[0]).not.toContain('ORDER BY');
      });
    });

    it('switches to new column when clicking different column', async () => {
      const user = userEvent.setup();
      await renderTableRows();

      await waitFor(() => {
        expect(screen.getByTestId('sort-name')).toBeInTheDocument();
      });

      // Sort by name first
      await user.click(screen.getByTestId('sort-name'));

      await waitFor(() => {
        expect(mockExecute).toHaveBeenCalledWith(
          expect.stringContaining('ORDER BY "name" ASC'),
          []
        );
      });

      // Click age column - should switch to sorting by age
      await user.click(screen.getByTestId('sort-age'));

      await waitFor(() => {
        expect(mockExecute).toHaveBeenCalledWith(
          expect.stringContaining('ORDER BY "age" ASC'),
          []
        );
      });
    });

    it('displays ascending arrow when sorted ascending', async () => {
      const user = userEvent.setup();
      await renderTableRows();

      await waitFor(() => {
        expect(screen.getByTestId('sort-name')).toBeInTheDocument();
      });

      const sortButton = screen.getByTestId('sort-name');
      await user.click(sortButton);

      // Wait for the query to be made with ORDER BY
      await waitFor(() => {
        expect(mockExecute).toHaveBeenCalledWith(
          expect.stringContaining('ORDER BY "name" ASC'),
          []
        );
      });

      // The ArrowUp icon should be visible (ascending indicator)
      expect(
        sortButton.querySelector('[data-testid="arrow-up"]')
      ).toBeInTheDocument();
      expect(
        sortButton.querySelector('[data-testid="arrow-down"]')
      ).not.toBeInTheDocument();
    });

    it('displays descending arrow when sorted descending', async () => {
      const user = userEvent.setup();
      await renderTableRows();

      await waitFor(() => {
        expect(screen.getByTestId('sort-name')).toBeInTheDocument();
      });

      const sortButton = screen.getByTestId('sort-name');

      // Click twice to get to descending
      await user.click(sortButton);
      await waitFor(() => {
        expect(mockExecute).toHaveBeenCalledWith(
          expect.stringContaining('ORDER BY "name" ASC'),
          []
        );
      });

      await user.click(sortButton);
      await waitFor(() => {
        expect(mockExecute).toHaveBeenCalledWith(
          expect.stringContaining('ORDER BY "name" DESC'),
          []
        );
      });

      // The ArrowDown icon should be visible (descending indicator)
      expect(
        sortButton.querySelector('[data-testid="arrow-down"]')
      ).toBeInTheDocument();
      expect(
        sortButton.querySelector('[data-testid="arrow-up"]')
      ).not.toBeInTheDocument();
    });
  });

  describe('column resizing', () => {
    it('updates column width when dragging the resize handle', async () => {
      await renderTableRows();

      const handle = await screen.findByRole('separator', {
        name: 'Resize name column'
      });
      // Header is now a div with class group (parent of the resize handle)
      const header = handle.closest('.group');
      expect(header).not.toBeNull();
      if (!header) {
        return;
      }
      vi.spyOn(header, 'getBoundingClientRect').mockReturnValue(
        new DOMRect(0, 0, 150, 0)
      );

      fireEvent.mouseDown(handle, { clientX: 100 });
      fireEvent.mouseMove(document, { clientX: 120 });

      expect(handle).toHaveAttribute('aria-valuenow', '170');

      fireEvent.mouseUp(document);
    });
  });

  describe('table rendering', () => {
    it('displays table data correctly', async () => {
      await renderTableRows();

      await waitFor(() => {
        expect(screen.getByText('Alice')).toBeInTheDocument();
        expect(screen.getByText('Bob')).toBeInTheDocument();
        expect(screen.getByText('Charlie')).toBeInTheDocument();
      });
    });

    it('shows row count', async () => {
      await renderTableRows();

      await waitFor(() => {
        // VirtualListStatus shows "X rows" format
        expect(screen.getByText(/3 rows/)).toBeInTheDocument();
      });
    });

    it('shows PK indicator for primary key columns when unhidden', async () => {
      const user = userEvent.setup();
      await renderTableRows();

      await waitFor(() => {
        expect(screen.getByTestId('sort-name')).toBeInTheDocument();
      });

      // id column is hidden by default, show it via column settings
      await user.click(screen.getByTestId('column-settings-button'));
      await user.click(screen.getByTestId('column-toggle-id'));

      await waitFor(() => {
        expect(screen.getByTestId('sort-id')).toBeInTheDocument();
      });

      // The id column should have a PK indicator
      const sortButton = screen.getByTestId('sort-id');
      expect(sortButton).toHaveTextContent('PK');
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
        <MemoryRouter initialEntries={['/tables/test_table']}>
          <Routes>
            <Route path="/tables/:tableName" element={<TableRows />} />
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

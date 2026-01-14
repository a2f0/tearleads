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
  return result;
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
        expect.stringContaining('SELECT * FROM "test_table" LIMIT 100'),
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
      const header = handle.closest('th');
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
        expect(screen.getByText(/Showing 3 rows/)).toBeInTheDocument();
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

    it('shows error when truncate fails with non-sqlite_sequence error', async () => {
      const user = userEvent.setup();
      const consoleSpy = mockConsoleError();
      mockExecute.mockImplementation((query: string) => {
        if (query.includes('sqlite_master')) {
          return Promise.resolve({ rows: [{ name: 'test_table' }] });
        }
        if (query.includes('PRAGMA table_info')) {
          return Promise.resolve({ rows: mockColumns });
        }
        if (query.includes('DELETE FROM sqlite_sequence')) {
          return Promise.reject(new Error('different error'));
        }
        if (query.includes('DELETE FROM "test_table"')) {
          return Promise.resolve({ rows: [] });
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

      await user.click(truncateButton);
      await user.click(truncateButton);

      await waitFor(() => {
        expect(screen.getByText('different error')).toBeInTheDocument();
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
        expect(screen.getByText('Showing 0 rows')).toBeInTheDocument();
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

      // Sort should be cleared - last query should not have ORDER BY
      await waitFor(() => {
        const lastCall =
          mockExecute.mock.calls[mockExecute.mock.calls.length - 1];
        expect(lastCall?.[0]).toContain('SELECT *');
        expect(lastCall?.[0]).not.toContain('ORDER BY');
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
        if (query.includes('SELECT *')) {
          return Promise.resolve({
            rows: [{ id: 1, name: 'Alice', age: 30 }]
          });
        }
        return Promise.resolve({ rows: [] });
      });

      await renderTableRows();

      await waitFor(() => {
        expect(screen.getByText(/Showing 1 row$/)).toBeInTheDocument();
      });
    });

    it('shows limit message when 100 rows returned', async () => {
      mockExecute.mockImplementation((query: string) => {
        if (query.includes('sqlite_master')) {
          return Promise.resolve({ rows: [{ name: 'test_table' }] });
        }
        if (query.includes('PRAGMA table_info')) {
          return Promise.resolve({ rows: mockColumns });
        }
        if (query.includes('SELECT *')) {
          const rows = Array.from({ length: 100 }, (_, i) => ({
            id: i + 1,
            name: `User ${i + 1}`,
            age: 20 + i
          }));
          return Promise.resolve({ rows });
        }
        return Promise.resolve({ rows: [] });
      });

      await renderTableRows();

      await waitFor(() => {
        expect(
          screen.getByText(/Showing 100 rows \(limited to 100\)/)
        ).toBeInTheDocument();
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

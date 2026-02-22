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

  it('shows back link to tables', async () => {
    await renderTableRows();

    expect(screen.getByTestId('back-link')).toBeInTheDocument();
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
});

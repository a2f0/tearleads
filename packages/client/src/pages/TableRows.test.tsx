import { render, screen, waitFor } from '@testing-library/react';
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

// Mock database adapter
const mockExecute = vi.fn();
vi.mock('@/db', () => ({
  getDatabaseAdapter: vi.fn(() => ({
    execute: mockExecute
  }))
}));

// Mock database context
vi.mock('@/db/hooks', () => ({
  useDatabaseContext: vi.fn(() => ({
    isUnlocked: true,
    isLoading: false
  }))
}));

function renderTableRows(tableName = 'test_table') {
  return render(
    <MemoryRouter initialEntries={[`/tables/${tableName}`]}>
      <Routes>
        <Route path="/tables/:tableName" element={<TableRows />} />
      </Routes>
    </MemoryRouter>
  );
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
    it('renders sort buttons for each column', async () => {
      renderTableRows();

      await waitFor(() => {
        expect(screen.getByTestId('sort-id')).toBeInTheDocument();
        expect(screen.getByTestId('sort-name')).toBeInTheDocument();
        expect(screen.getByTestId('sort-age')).toBeInTheDocument();
      });
    });

    it('shows unsorted icon initially', async () => {
      renderTableRows();

      await waitFor(() => {
        expect(screen.getByTestId('sort-id')).toBeInTheDocument();
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
      renderTableRows();

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
      renderTableRows();

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
      renderTableRows();

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
      renderTableRows();

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

  describe('table rendering', () => {
    it('displays table data correctly', async () => {
      renderTableRows();

      await waitFor(() => {
        expect(screen.getByText('Alice')).toBeInTheDocument();
        expect(screen.getByText('Bob')).toBeInTheDocument();
        expect(screen.getByText('Charlie')).toBeInTheDocument();
      });
    });

    it('shows row count', async () => {
      renderTableRows();

      await waitFor(() => {
        expect(screen.getByText(/Showing 3 rows/)).toBeInTheDocument();
      });
    });

    it('shows PK indicator for primary key columns', async () => {
      renderTableRows();

      await waitFor(() => {
        expect(screen.getByTestId('sort-id')).toBeInTheDocument();
      });

      // The id column should have a PK indicator
      const sortButton = screen.getByTestId('sort-id');
      expect(sortButton).toHaveTextContent('PK');
    });
  });
});

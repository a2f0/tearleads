import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PostgresTableSizes } from './PostgresTableSizes';

function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

const mockGetTables = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    admin: {
      getContext: vi.fn().mockResolvedValue({
        isRootAdmin: true,
        organizations: [{ id: 'org-1', name: 'Org 1' }]
      }),
      postgres: {
        getTables: () => mockGetTables()
      }
    }
  }
}));

describe('PostgresTableSizes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders table summary rows', async () => {
    mockGetTables.mockResolvedValue({
      tables: [
        {
          schema: 'public',
          name: 'users',
          rowCount: 12,
          totalBytes: 2048,
          tableBytes: 1024,
          indexBytes: 1024
        }
      ]
    });

    renderWithRouter(<PostgresTableSizes />);

    await waitFor(() => {
      expect(screen.getByText('public.users')).toBeInTheDocument();
    });

    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getAllByText('2.00KB')).toHaveLength(2);
  });

  it('shows empty state when no tables exist', async () => {
    mockGetTables.mockResolvedValue({
      tables: []
    });

    renderWithRouter(<PostgresTableSizes />);

    await waitFor(() => {
      expect(screen.getByText('No tables found')).toBeInTheDocument();
    });

    expect(screen.getByText('0B')).toBeInTheDocument();
  });

  it('shows error when table fetch fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockGetTables.mockRejectedValueOnce(new Error('No access'));

    renderWithRouter(<PostgresTableSizes />);

    await waitFor(() => {
      expect(screen.getByText('No access')).toBeInTheDocument();
    });

    expect(screen.queryByText('Total Database')).not.toBeInTheDocument();
    consoleSpy.mockRestore();
  });

  it('sorts tables alphabetically by schema and name', async () => {
    mockGetTables.mockResolvedValue({
      tables: [
        {
          schema: 'public',
          name: 'zeta_table',
          rowCount: 5,
          totalBytes: 1024,
          tableBytes: 512,
          indexBytes: 512
        },
        {
          schema: 'admin',
          name: 'alpha_table',
          rowCount: 100,
          totalBytes: 10240,
          tableBytes: 8192,
          indexBytes: 2048
        },
        {
          schema: 'public',
          name: 'alpha_table',
          rowCount: 8,
          totalBytes: 2048,
          tableBytes: 1536,
          indexBytes: 512
        }
      ]
    });

    renderWithRouter(<PostgresTableSizes />);

    await waitFor(() => {
      expect(screen.getByText('admin.alpha_table')).toBeInTheDocument();
    });

    const tableLabels = screen.getAllByText(/public\./);
    expect(screen.getAllByText(/admin\./)[0]).toHaveTextContent(
      'admin.alpha_table'
    );
    expect(tableLabels[0]).toHaveTextContent('public.alpha_table');
    expect(tableLabels[1]).toHaveTextContent('public.zeta_table');
  });

  it('calls onTableSelect when table button is clicked', async () => {
    const user = userEvent.setup();
    const onTableSelect = vi.fn();
    mockGetTables.mockResolvedValue({
      tables: [
        {
          schema: 'public',
          name: 'users',
          rowCount: 12,
          totalBytes: 2048,
          tableBytes: 1024,
          indexBytes: 1024
        }
      ]
    });

    renderWithRouter(<PostgresTableSizes onTableSelect={onTableSelect} />);

    await waitFor(() => {
      expect(screen.getByText('public.users')).toBeInTheDocument();
    });

    await user.click(screen.getByText('public.users'));

    expect(onTableSelect).toHaveBeenCalledWith('public', 'users');
  });

  it('calls onTableSelect when row count is clicked', async () => {
    const user = userEvent.setup();
    const onTableSelect = vi.fn();
    mockGetTables.mockResolvedValue({
      tables: [
        {
          schema: 'public',
          name: 'users',
          rowCount: 12,
          totalBytes: 2048,
          tableBytes: 1024,
          indexBytes: 1024
        }
      ]
    });

    renderWithRouter(<PostgresTableSizes onTableSelect={onTableSelect} />);

    await waitFor(() => {
      expect(screen.getByText('public.users')).toBeInTheDocument();
    });

    await user.click(screen.getByText('12'));

    expect(onTableSelect).toHaveBeenCalledWith('public', 'users');
  });
});

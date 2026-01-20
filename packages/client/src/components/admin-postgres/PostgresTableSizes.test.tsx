import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PostgresTableSizes } from './PostgresTableSizes';

const mockGetTables = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    admin: {
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

    render(<PostgresTableSizes />);

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

    render(<PostgresTableSizes />);

    await waitFor(() => {
      expect(screen.getByText('No tables found')).toBeInTheDocument();
    });

    expect(screen.getByText('0B')).toBeInTheDocument();
  });

  it('shows error when table fetch fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockGetTables.mockRejectedValueOnce(new Error('No access'));

    render(<PostgresTableSizes />);

    await waitFor(() => {
      expect(screen.getByText('No access')).toBeInTheDocument();
    });

    expect(screen.queryByText('Total Database')).not.toBeInTheDocument();
    consoleSpy.mockRestore();
  });
});

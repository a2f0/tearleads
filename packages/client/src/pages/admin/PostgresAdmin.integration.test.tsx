import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { PostgresAdmin } from './PostgresAdmin';

const mockGetInfo = vi.fn();
const mockGetTables = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    admin: {
      postgres: {
        getInfo: () => mockGetInfo(),
        getTables: () => mockGetTables()
      }
    }
  }
}));

describe('PostgresAdmin integration', () => {
  it('renders connection and table data', async () => {
    mockGetInfo.mockResolvedValue({
      status: 'ok',
      info: {
        host: 'localhost',
        port: 5432,
        database: 'rapid',
        user: 'rapid'
      },
      serverVersion: 'PostgreSQL 15.1'
    });
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

    render(
      <MemoryRouter>
        <PostgresAdmin />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Connected')).toBeInTheDocument();
    });

    expect(screen.getByText('PostgreSQL 15.1')).toBeInTheDocument();
    expect(screen.getByText('public.users')).toBeInTheDocument();
    expect(screen.getAllByText('2.00 KB')).toHaveLength(2);
    expect(screen.getAllByText('rapid')).toHaveLength(2);
  });
});

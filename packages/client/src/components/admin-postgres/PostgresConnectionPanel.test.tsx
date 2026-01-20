import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PostgresConnectionPanel } from './PostgresConnectionPanel';

const mockGetInfo = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    admin: {
      postgres: {
        getInfo: () => mockGetInfo()
      }
    }
  }
}));

describe('PostgresConnectionPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders connection details', async () => {
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

    render(<PostgresConnectionPanel />);

    await waitFor(() => {
      expect(screen.getByText('Connected')).toBeInTheDocument();
    });

    expect(screen.getByText('PostgreSQL 15.1')).toBeInTheDocument();
    expect(screen.getByText('localhost')).toBeInTheDocument();
    expect(screen.getByText('5432')).toBeInTheDocument();
    expect(screen.getAllByText('rapid')).toHaveLength(2);
  });

  it('renders error state when the connection fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockGetInfo.mockRejectedValueOnce(new Error('Connection failed'));

    render(<PostgresConnectionPanel />);

    await waitFor(() => {
      expect(screen.getByText('Unavailable')).toBeInTheDocument();
    });

    expect(screen.getByText('Connection failed')).toBeInTheDocument();
    expect(screen.getAllByText('Unknown')).toHaveLength(5);

    consoleSpy.mockRestore();
  });
});

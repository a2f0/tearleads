import type { RedisKeysResponse } from '@rapid/shared';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Admin } from './Admin';

const mockGetKeys = vi.fn<() => Promise<RedisKeysResponse>>();

vi.mock('@/lib/api', () => ({
  api: {
    admin: {
      redis: {
        getKeys: () => mockGetKeys()
      }
    }
  }
}));

function renderAdmin() {
  return render(
    <MemoryRouter>
      <Admin />
    </MemoryRouter>
  );
}

describe('Admin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetKeys.mockResolvedValue({ keys: [] });
  });

  describe('page rendering', () => {
    it('renders the page title', async () => {
      renderAdmin();

      await waitFor(() => {
        expect(screen.getByText('Admin')).toBeInTheDocument();
      });
    });

    it('renders subtitle', async () => {
      renderAdmin();

      await waitFor(() => {
        expect(screen.getByText('Redis Browser')).toBeInTheDocument();
      });
    });

    it('renders Refresh button', async () => {
      renderAdmin();

      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: 'Refresh' })
        ).toBeInTheDocument();
      });
    });
  });

  describe('empty state', () => {
    it('shows empty state message when no keys exist', async () => {
      mockGetKeys.mockResolvedValue({ keys: [] });

      renderAdmin();

      await waitFor(() => {
        expect(screen.getByText('No keys found.')).toBeInTheDocument();
      });
    });

    it('shows "0 keys" count', async () => {
      mockGetKeys.mockResolvedValue({ keys: [] });

      renderAdmin();

      await waitFor(() => {
        expect(screen.getByText('0 keys')).toBeInTheDocument();
      });
    });
  });

  describe('with key data', () => {
    const testKeys = [
      { key: 'user:1', type: 'hash', ttl: -1 },
      { key: 'session:abc', type: 'string', ttl: 3600 }
    ];

    beforeEach(() => {
      mockGetKeys.mockResolvedValue({ keys: testKeys });
    });

    it('displays key names', async () => {
      renderAdmin();

      await waitFor(() => {
        expect(screen.getByText('user:1')).toBeInTheDocument();
        expect(screen.getByText('session:abc')).toBeInTheDocument();
      });
    });

    it('displays key count in header', async () => {
      renderAdmin();

      await waitFor(() => {
        expect(screen.getByText('2 keys')).toBeInTheDocument();
      });
    });

    it('displays key types', async () => {
      renderAdmin();

      await waitFor(() => {
        expect(screen.getByText('hash')).toBeInTheDocument();
        expect(screen.getByText('string')).toBeInTheDocument();
      });
    });

    it('displays TTL information', async () => {
      renderAdmin();

      await waitFor(() => {
        expect(screen.getByText('No expiry')).toBeInTheDocument();
        expect(screen.getByText('1h')).toBeInTheDocument();
      });
    });
  });

  describe('singular/plural key count', () => {
    it('shows singular "key" for 1 key', async () => {
      mockGetKeys.mockResolvedValue({
        keys: [{ key: 'only', type: 'string', ttl: -1 }]
      });

      renderAdmin();

      await waitFor(() => {
        expect(screen.getByText('1 key')).toBeInTheDocument();
      });
    });

    it('shows plural "keys" for multiple keys', async () => {
      mockGetKeys.mockResolvedValue({
        keys: [
          { key: 'first', type: 'string', ttl: -1 },
          { key: 'second', type: 'string', ttl: -1 }
        ]
      });

      renderAdmin();

      await waitFor(() => {
        expect(screen.getByText('2 keys')).toBeInTheDocument();
      });
    });
  });

  describe('expand/collapse functionality', () => {
    beforeEach(() => {
      mockGetKeys.mockResolvedValue({
        keys: [{ key: 'test:key', type: 'string', ttl: 3600 }]
      });
    });

    it('expands key details when clicked', async () => {
      const user = userEvent.setup();
      renderAdmin();

      await waitFor(() => {
        expect(screen.getByText('test:key')).toBeInTheDocument();
      });

      const keyRow = screen.getByRole('button', { name: /test:key/i });
      await user.click(keyRow);

      await waitFor(() => {
        expect(screen.getByText(/Key:/)).toBeInTheDocument();
        expect(screen.getByText(/Type:/)).toBeInTheDocument();
        expect(screen.getByText(/TTL:/)).toBeInTheDocument();
      });
    });

    it('collapses key details when clicked again', async () => {
      const user = userEvent.setup();
      renderAdmin();

      await waitFor(() => {
        expect(screen.getByText('test:key')).toBeInTheDocument();
      });

      const keyRow = screen.getByRole('button', { name: /test:key/i });

      // Expand
      await user.click(keyRow);
      await waitFor(() => {
        expect(screen.getByText(/Key:/)).toBeInTheDocument();
      });

      // Collapse
      await user.click(keyRow);
      await waitFor(() => {
        expect(screen.queryByText(/Key:/)).not.toBeInTheDocument();
      });
    });
  });

  describe('refresh functionality', () => {
    it('refreshes content when refresh button is clicked', async () => {
      mockGetKeys.mockResolvedValue({ keys: [] });

      const user = userEvent.setup();
      renderAdmin();

      await waitFor(() => {
        expect(screen.getByText('No keys found.')).toBeInTheDocument();
      });

      expect(mockGetKeys).toHaveBeenCalledTimes(1);

      await user.click(screen.getByRole('button', { name: 'Refresh' }));

      await waitFor(() => {
        expect(mockGetKeys).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('error handling', () => {
    it('displays error message when API fails', async () => {
      mockGetKeys.mockRejectedValue(new Error('Failed to connect to Redis'));

      renderAdmin();

      await waitFor(() => {
        expect(
          screen.getByText('Failed to connect to Redis')
        ).toBeInTheDocument();
      });
    });
  });

  describe('loading state', () => {
    it('shows loading state initially', async () => {
      mockGetKeys.mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      renderAdmin();

      expect(screen.getByText('Loading Redis keys...')).toBeInTheDocument();
    });
  });
});

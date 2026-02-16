import type { RedisKeysResponse } from '@tearleads/shared';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockConsoleError } from '@/test/consoleMocks';
import { Admin } from './Admin';

const mockGetKeys =
  vi.fn<(cursor?: string, limit?: number) => Promise<RedisKeysResponse>>();
const mockDeleteKey = vi.fn<(key: string) => Promise<{ deleted: boolean }>>();
const mockGetDbSize = vi.fn<() => Promise<{ count: number }>>();

vi.mock('@/lib/api', () => ({
  api: {
    admin: {
      getContext: vi.fn().mockResolvedValue({
        isRootAdmin: true,
        organizations: [{ id: 'org-1', name: 'Org 1' }]
      }),
      redis: {
        getKeys: (cursor?: string, limit?: number) =>
          mockGetKeys(cursor, limit),
        deleteKey: (key: string) => mockDeleteKey(key),
        getDbSize: () => mockGetDbSize()
      }
    }
  }
}));

// Mock useVirtualizer to simplify testing
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: vi.fn(
    (options: { count: number } & Record<string, unknown>) => {
      const getScrollElement = options['getScrollElement'];
      if (typeof getScrollElement === 'function') {
        getScrollElement();
      }

      const estimateSize = options['estimateSize'];
      if (typeof estimateSize === 'function') {
        estimateSize();
      }

      const { count } = options;

      return {
        getVirtualItems: () =>
          Array.from({ length: count }, (_, i) => ({
            index: i,
            start: i * 48,
            size: 48,
            key: i
          })),
        getTotalSize: () => count * 48,
        measureElement: vi.fn()
      };
    }
  )
}));

const renderAdmin = (showBackLink = true) => {
  return render(
    <MemoryRouter>
      <Admin showBackLink={showBackLink} />
    </MemoryRouter>
  );
};

const renderAdminAndWait = async (showBackLink = true) => {
  renderAdmin(showBackLink);
  await waitFor(() => {
    expect(screen.getByText('Admin')).toBeInTheDocument();
  });
};

describe('Admin (basic)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetKeys.mockResolvedValue({ keys: [], cursor: '0', hasMore: false });
    mockDeleteKey.mockResolvedValue({ deleted: true });
    mockGetDbSize.mockResolvedValue({ count: 0 });
  });

  describe('page rendering', () => {
    it('renders chrome and navigation by default', async () => {
      await renderAdminAndWait();

      expect(screen.getByText('Redis Browser')).toBeInTheDocument();
      expect(screen.getByTestId('back-link')).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Refresh' })
      ).toBeInTheDocument();
    });

    it('hides back link when disabled', async () => {
      renderAdmin(false);

      await waitFor(() => {
        expect(screen.queryByTestId('back-link')).not.toBeInTheDocument();
      });
    });
  });

  describe('empty state', () => {
    it('shows empty state message and count', async () => {
      mockGetKeys.mockResolvedValue({ keys: [], cursor: '0', hasMore: false });
      mockGetDbSize.mockResolvedValue({ count: 0 });

      renderAdmin();

      await waitFor(() => {
        expect(screen.getByText('No keys found.')).toBeInTheDocument();
        expect(screen.getByText(/0 keys/)).toBeInTheDocument();
      });
    });
  });

  describe('with key data', () => {
    const testKeys = [
      { key: 'user:1', type: 'hash', ttl: -1 },
      { key: 'session:abc', type: 'string', ttl: 3600 }
    ];

    beforeEach(() => {
      mockGetKeys.mockResolvedValue({
        keys: testKeys,
        cursor: '0',
        hasMore: false
      });
    });

    it('displays key names, types, and TTL information', async () => {
      renderAdmin();

      await waitFor(() => {
        expect(screen.getByText('user:1')).toBeInTheDocument();
        expect(screen.getByText('session:abc')).toBeInTheDocument();
        expect(screen.getByText('hash')).toBeInTheDocument();
        expect(screen.getByText('string')).toBeInTheDocument();
        expect(screen.getByText('No expiry')).toBeInTheDocument();
        expect(screen.getByText('1h')).toBeInTheDocument();
      });
    });

    it('displays key count in header', async () => {
      mockGetDbSize.mockResolvedValue({ count: 2 });
      renderAdmin();

      await waitFor(() => {
        expect(screen.getByText(/2 keys$/)).toBeInTheDocument();
      });
    });
  });

  describe('key count display', () => {
    it.each([
      ['1 key', [{ key: 'only', type: 'string', ttl: -1 }], 1],
      [
        '2 keys',
        [
          { key: 'first', type: 'string', ttl: -1 },
          { key: 'second', type: 'string', ttl: -1 }
        ],
        2
      ]
    ])('shows count for %s', async (_label, keys, count) => {
      mockGetKeys.mockResolvedValue({
        keys,
        cursor: '0',
        hasMore: false
      });
      mockGetDbSize.mockResolvedValue({ count });

      renderAdmin();

      await waitFor(() => {
        expect(
          screen.getByText(new RegExp(`${count} key`))
        ).toBeInTheDocument();
      });
    });
  });

  describe('refresh functionality', () => {
    it('refreshes content when refresh button is clicked', async () => {
      mockGetKeys.mockResolvedValue({ keys: [], cursor: '0', hasMore: false });

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
      const consoleSpy = mockConsoleError();
      mockGetKeys.mockRejectedValue(new Error('Failed to connect to Redis'));

      renderAdmin();

      await waitFor(() => {
        expect(
          screen.getByText('Failed to connect to Redis')
        ).toBeInTheDocument();
      });
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to fetch Redis keys:',
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });
  });

  describe('loading state', () => {
    it('shows loading state initially', async () => {
      mockGetKeys.mockImplementation(() => new Promise(() => {}));
      mockGetDbSize.mockImplementation(() => new Promise(() => {}));

      renderAdmin();

      expect(screen.getByText('Loading Redis keys...')).toBeInTheDocument();
    });
  });

  describe('pagination', () => {
    it('passes cursor to API for initial request', async () => {
      mockGetKeys.mockResolvedValue({
        keys: [],
        cursor: '0',
        hasMore: false
      });

      renderAdmin();

      await waitFor(() => {
        expect(mockGetKeys).toHaveBeenCalledWith('0', 50);
      });
    });
  });

  describe('total count display', () => {
    it('shows total count from dbsize', async () => {
      mockGetKeys.mockResolvedValue({
        keys: [{ key: 'test:key', type: 'string', ttl: -1 }],
        cursor: '0',
        hasMore: false
      });
      mockGetDbSize.mockResolvedValue({ count: 100 });

      renderAdmin();

      await waitFor(() => {
        expect(screen.getByText(/100 total/)).toBeInTheDocument();
      });
    });

    it('fetches dbsize on mount', async () => {
      renderAdmin();

      await waitFor(() => {
        expect(mockGetDbSize).toHaveBeenCalled();
      });
    });

    it('shows hasMore indicator when dbsize fails', async () => {
      const consoleSpy = mockConsoleError();
      mockGetKeys.mockResolvedValue({
        keys: [{ key: 'test:key', type: 'string', ttl: -1 }],
        cursor: '0',
        hasMore: true
      });
      mockGetDbSize.mockRejectedValue(new Error('Failed'));

      renderAdmin();

      await waitFor(() => {
        expect(screen.getByText(/1\+ key/)).toBeInTheDocument();
      });
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to fetch Redis db size:',
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });

    it('shows viewing range when total count is available', async () => {
      mockGetKeys.mockResolvedValue({
        keys: [
          { key: 'key:1', type: 'string', ttl: -1 },
          { key: 'key:2', type: 'string', ttl: -1 },
          { key: 'key:3', type: 'string', ttl: -1 }
        ],
        cursor: '0',
        hasMore: false
      });
      mockGetDbSize.mockResolvedValue({ count: 3 });

      renderAdmin();

      await waitFor(() => {
        expect(screen.getByText(/3 keys$/)).toBeInTheDocument();
      });
    });
  });
});

import type { RedisKeysResponse } from '@rapid/shared';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Admin } from './Admin';

const mockGetKeys =
  vi.fn<(cursor?: string, limit?: number) => Promise<RedisKeysResponse>>();
const mockDeleteKey = vi.fn<(key: string) => Promise<{ deleted: boolean }>>();
const mockGetDbSize = vi.fn<() => Promise<{ count: number }>>();

vi.mock('@/lib/api', () => ({
  api: {
    admin: {
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
  useVirtualizer: vi.fn(({ count }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, i) => ({
        index: i,
        start: i * 48,
        size: 48,
        key: i
      })),
    getTotalSize: () => count * 48,
    measureElement: vi.fn()
  }))
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
    mockGetKeys.mockResolvedValue({ keys: [], cursor: '0', hasMore: false });
    mockDeleteKey.mockResolvedValue({ deleted: true });
    mockGetDbSize.mockResolvedValue({ count: 0 });
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
      mockGetKeys.mockResolvedValue({ keys: [], cursor: '0', hasMore: false });

      renderAdmin();

      await waitFor(() => {
        expect(screen.getByText('No keys found.')).toBeInTheDocument();
      });
    });

    it('shows "0 loaded" count', async () => {
      mockGetKeys.mockResolvedValue({ keys: [], cursor: '0', hasMore: false });
      mockGetDbSize.mockResolvedValue({ count: 0 });

      renderAdmin();

      await waitFor(() => {
        expect(screen.getByText(/0 loaded/)).toBeInTheDocument();
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

    it('displays key names', async () => {
      renderAdmin();

      await waitFor(() => {
        expect(screen.getByText('user:1')).toBeInTheDocument();
        expect(screen.getByText('session:abc')).toBeInTheDocument();
      });
    });

    it('displays key count in header', async () => {
      mockGetDbSize.mockResolvedValue({ count: 2 });
      renderAdmin();

      await waitFor(() => {
        expect(screen.getByText(/2 loaded/)).toBeInTheDocument();
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

  describe('loaded key count', () => {
    it('shows loaded count for 1 key', async () => {
      mockGetKeys.mockResolvedValue({
        keys: [{ key: 'only', type: 'string', ttl: -1 }],
        cursor: '0',
        hasMore: false
      });
      mockGetDbSize.mockResolvedValue({ count: 1 });

      renderAdmin();

      await waitFor(() => {
        expect(screen.getByText(/1 loaded/)).toBeInTheDocument();
      });
    });

    it('shows loaded count for multiple keys', async () => {
      mockGetKeys.mockResolvedValue({
        keys: [
          { key: 'first', type: 'string', ttl: -1 },
          { key: 'second', type: 'string', ttl: -1 }
        ],
        cursor: '0',
        hasMore: false
      });
      mockGetDbSize.mockResolvedValue({ count: 2 });

      renderAdmin();

      await waitFor(() => {
        expect(screen.getByText(/2 loaded/)).toBeInTheDocument();
      });
    });
  });

  describe('expand/collapse functionality', () => {
    beforeEach(() => {
      mockGetKeys.mockResolvedValue({
        keys: [{ key: 'test:key', type: 'string', ttl: 3600 }],
        cursor: '0',
        hasMore: false
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

    it('shows fallback text when dbsize fails', async () => {
      mockGetKeys.mockResolvedValue({
        keys: [{ key: 'test:key', type: 'string', ttl: -1 }],
        cursor: '0',
        hasMore: true
      });
      mockGetDbSize.mockRejectedValue(new Error('Failed'));

      renderAdmin();

      await waitFor(() => {
        expect(screen.getByText(/1 loaded\+/)).toBeInTheDocument();
      });
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
        expect(screen.getByText(/Viewing 1-3 of 3 loaded/)).toBeInTheDocument();
      });
    });
  });

  describe('context menu', () => {
    beforeEach(() => {
      mockGetKeys.mockResolvedValue({
        keys: [{ key: 'test:key', type: 'string', ttl: -1 }],
        cursor: '0',
        hasMore: false
      });
      mockGetDbSize.mockResolvedValue({ count: 1 });
    });

    it('shows context menu on right-click', async () => {
      const user = userEvent.setup();
      renderAdmin();

      await waitFor(() => {
        expect(screen.getByText('test:key')).toBeInTheDocument();
      });

      const keyRow = screen.getByText('test:key').closest('div');
      expect(keyRow).not.toBeNull();
      await user.pointer({ target: keyRow as Element, keys: '[MouseRight]' });

      await waitFor(() => {
        expect(screen.getByText('Delete')).toBeInTheDocument();
      });
    });

    it('closes context menu when clicking delete', async () => {
      const user = userEvent.setup();
      renderAdmin();

      await waitFor(() => {
        expect(screen.getByText('test:key')).toBeInTheDocument();
      });

      const keyRow = screen.getByText('test:key').closest('div');
      expect(keyRow).not.toBeNull();
      await user.pointer({ target: keyRow as Element, keys: '[MouseRight]' });

      await waitFor(() => {
        expect(screen.getByText('Delete')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Delete'));

      await waitFor(() => {
        expect(screen.queryByText('Delete')).not.toBeInTheDocument();
      });
    });

    it('removes key from list after delete', async () => {
      const user = userEvent.setup();
      renderAdmin();

      await waitFor(() => {
        expect(screen.getByText('test:key')).toBeInTheDocument();
      });

      const keyRow = screen.getByText('test:key').closest('div');
      expect(keyRow).not.toBeNull();
      await user.pointer({ target: keyRow as Element, keys: '[MouseRight]' });

      await waitFor(() => {
        expect(screen.getByText('Delete')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Delete'));

      await waitFor(() => {
        expect(screen.queryByText('test:key')).not.toBeInTheDocument();
      });
    });

    it('calls deleteKey API with correct key', async () => {
      const user = userEvent.setup();
      renderAdmin();

      await waitFor(() => {
        expect(screen.getByText('test:key')).toBeInTheDocument();
      });

      const keyRow = screen.getByText('test:key').closest('div');
      expect(keyRow).not.toBeNull();
      await user.pointer({ target: keyRow as Element, keys: '[MouseRight]' });

      await waitFor(() => {
        expect(screen.getByText('Delete')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Delete'));

      await waitFor(() => {
        expect(mockDeleteKey).toHaveBeenCalledWith('test:key');
      });
    });

    it('closes context menu on escape key', async () => {
      const user = userEvent.setup();
      renderAdmin();

      await waitFor(() => {
        expect(screen.getByText('test:key')).toBeInTheDocument();
      });

      const keyRow = screen.getByText('test:key').closest('div');
      expect(keyRow).not.toBeNull();
      await user.pointer({ target: keyRow as Element, keys: '[MouseRight]' });

      await waitFor(() => {
        expect(screen.getByText('Delete')).toBeInTheDocument();
      });

      await user.keyboard('{Escape}');

      await waitFor(() => {
        expect(screen.queryByText('Delete')).not.toBeInTheDocument();
      });
    });

    it('shows error when delete fails', async () => {
      mockDeleteKey.mockRejectedValue(new Error('Delete failed'));
      const user = userEvent.setup();
      renderAdmin();

      await waitFor(() => {
        expect(screen.getByText('test:key')).toBeInTheDocument();
      });

      const keyRow = screen.getByText('test:key').closest('div');
      expect(keyRow).not.toBeNull();
      await user.pointer({ target: keyRow as Element, keys: '[MouseRight]' });

      await waitFor(() => {
        expect(screen.getByText('Delete')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Delete'));

      await waitFor(() => {
        expect(screen.getByText('Delete failed')).toBeInTheDocument();
      });
    });

    it('does not remove key when delete returns false', async () => {
      mockDeleteKey.mockResolvedValue({ deleted: false });
      const user = userEvent.setup();
      renderAdmin();

      await waitFor(() => {
        expect(screen.getByText('test:key')).toBeInTheDocument();
      });

      const keyRow = screen.getByText('test:key').closest('div');
      expect(keyRow).not.toBeNull();
      await user.pointer({ target: keyRow as Element, keys: '[MouseRight]' });

      await waitFor(() => {
        expect(screen.getByText('Delete')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Delete'));

      await waitFor(() => {
        expect(screen.queryByText('Delete')).not.toBeInTheDocument();
      });

      // Key should still be in the list
      expect(screen.getByText('test:key')).toBeInTheDocument();
    });
  });
});

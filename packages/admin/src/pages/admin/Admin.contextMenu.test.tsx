import type { RedisKeysResponse } from '@tearleads/shared';
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

const renderAdmin = () => {
  return render(
    <MemoryRouter>
      <Admin showBackLink />
    </MemoryRouter>
  );
};

const openContextMenu = async (user: ReturnType<typeof userEvent.setup>) => {
  await waitFor(() => {
    expect(screen.getByText('test:key')).toBeInTheDocument();
  });

  const keyRow = screen.getByText('test:key').closest('div');
  expect(keyRow).not.toBeNull();
  await user.pointer({ target: keyRow as Element, keys: '[MouseRight]' });

  await waitFor(() => {
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });
};

describe('Admin (context menu)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetKeys.mockResolvedValue({
      keys: [{ key: 'test:key', type: 'string', ttl: -1 }],
      cursor: '0',
      hasMore: false
    });
    mockDeleteKey.mockResolvedValue({ deleted: true });
    mockGetDbSize.mockResolvedValue({ count: 1 });
  });

  describe('expand/collapse functionality', () => {
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

      await user.click(keyRow);
      await waitFor(() => {
        expect(screen.getByText(/Key:/)).toBeInTheDocument();
      });

      await user.click(keyRow);
      await waitFor(() => {
        expect(screen.queryByText(/Key:/)).not.toBeInTheDocument();
      });
    });
  });

  describe('context menu', () => {
    it('shows context menu on right-click', async () => {
      const user = userEvent.setup();
      renderAdmin();

      await openContextMenu(user);
    });

    it('shows confirm dialog when clicking delete', async () => {
      const user = userEvent.setup();
      renderAdmin();

      await openContextMenu(user);

      await user.click(screen.getByText('Delete'));

      await waitFor(() => {
        expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
        expect(
          screen.getByText(/Are you sure you want to delete/)
        ).toBeInTheDocument();
      });
    });

    it('removes key from list after confirming delete', async () => {
      const user = userEvent.setup();
      renderAdmin();

      await openContextMenu(user);

      await user.click(screen.getByText('Delete'));

      await waitFor(() => {
        expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('confirm-dialog-confirm'));

      await waitFor(() => {
        expect(screen.queryByText('test:key')).not.toBeInTheDocument();
      });
    });

    it('calls deleteKey API with correct key after confirming', async () => {
      const user = userEvent.setup();
      renderAdmin();

      await openContextMenu(user);

      await user.click(screen.getByText('Delete'));

      await waitFor(() => {
        expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('confirm-dialog-confirm'));

      await waitFor(() => {
        expect(mockDeleteKey).toHaveBeenCalledWith('test:key');
      });
    });
  });
});

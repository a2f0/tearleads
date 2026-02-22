import { ThemeProvider } from '@tearleads/ui';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockConsoleError } from '@/test/consoleMocks';
import { CacheStorage } from './CacheStorage';

// Helper to create mock Cache objects
function createMockCache(entries: Array<{ url: string; body: string }>) {
  const requestMap = new Map<string, Response>();

  for (const entry of entries) {
    const response = new Response(entry.body, {
      headers: { 'Content-Length': String(entry.body.length) }
    });
    requestMap.set(entry.url, response);
  }

  return {
    keys: vi.fn().mockResolvedValue(entries.map((e) => new Request(e.url))),
    match: vi.fn().mockImplementation((request: Request) => {
      return Promise.resolve(requestMap.get(request.url) ?? null);
    }),
    delete: vi.fn().mockResolvedValue(true)
  };
}

// Mock caches API
function setupMockCaches(
  caches: Record<string, ReturnType<typeof createMockCache>>
) {
  const cacheNames = Object.keys(caches);

  const mockCaches = {
    keys: vi.fn().mockResolvedValue(cacheNames),
    open: vi.fn().mockImplementation((name: string) => {
      return Promise.resolve(caches[name] ?? createMockCache([]));
    }),
    delete: vi.fn().mockResolvedValue(true)
  };

  Object.defineProperty(window, 'caches', {
    value: mockCaches,
    writable: true,
    configurable: true
  });

  return mockCaches;
}

function renderCacheStorage(showBackLink = true) {
  return render(
    <ThemeProvider>
      <MemoryRouter>
        <CacheStorage showBackLink={showBackLink} />
      </MemoryRouter>
    </ThemeProvider>
  );
}

describe('CacheStorage', () => {

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('when Cache Storage API is not supported', () => {
    beforeEach(() => {
      // Delete caches from window so 'caches' in window returns false
      delete (window as unknown as Record<string, unknown>)['caches'];
    });

    it('renders unsupported message', async () => {
      renderCacheStorage();

      await waitFor(() => {
        expect(
          screen.getByText(
            'Cache Storage API is not supported in this browser.'
          )
        ).toBeInTheDocument();
      });
    });

    it('shows back link by default', () => {
      renderCacheStorage();

      expect(screen.getByTestId('back-link')).toBeInTheDocument();
    });

    it('hides back link when disabled', () => {
      renderCacheStorage(false);

      expect(screen.queryByTestId('back-link')).not.toBeInTheDocument();
    });
  });

  describe('when Cache Storage is empty', () => {
    beforeEach(() => {
      setupMockCaches({});
    });

    it('renders empty state message', async () => {
      renderCacheStorage();

      await waitFor(() => {
        expect(screen.getByText('Cache Storage is empty.')).toBeInTheDocument();
      });
    });

    it('renders helpful description', async () => {
      renderCacheStorage();

      await waitFor(() => {
        expect(
          screen.getByText(
            'LLM models and other cached resources will appear here.'
          )
        ).toBeInTheDocument();
      });
    });

    it('does not show Clear All button', async () => {
      renderCacheStorage();

      await waitFor(() => {
        expect(screen.getByText('Cache Storage is empty.')).toBeInTheDocument();
      });

      expect(screen.queryByText('Clear All')).not.toBeInTheDocument();
    });
  });

  describe('when Cache Storage has entries', () => {
    let mockCaches: ReturnType<typeof setupMockCaches>;

    beforeEach(() => {
      mockCaches = setupMockCaches({
        'test-cache': createMockCache([
          { url: 'https://example.com/api/data', body: 'test data content' },
          { url: 'https://example.com/api/other', body: 'other content' }
        ]),
        'another-cache': createMockCache([
          { url: 'https://example.com/image.png', body: 'image bytes' }
        ])
      });
    });

    it('renders the page title', async () => {
      renderCacheStorage();

      expect(screen.getByText('Cache Storage Browser')).toBeInTheDocument();
    });

    it('renders cache names', async () => {
      renderCacheStorage();

      await waitFor(() => {
        expect(screen.getByText('test-cache')).toBeInTheDocument();
        expect(screen.getByText('another-cache')).toBeInTheDocument();
      });
    });

    it('renders summary with cache count and total entries', async () => {
      renderCacheStorage();

      await waitFor(() => {
        expect(screen.getByText(/2 caches/)).toBeInTheDocument();
        expect(screen.getByText(/3 total entries/)).toBeInTheDocument();
      });
    });

    it('renders Clear All button when caches exist', async () => {
      renderCacheStorage();

      await waitFor(() => {
        expect(screen.getByText('Clear All')).toBeInTheDocument();
      });
    });

    it('renders Refresh button', async () => {
      renderCacheStorage();

      expect(
        screen.getByRole('button', { name: 'Refresh' })
      ).toBeInTheDocument();
    });

    it('expands cache entries by default', async () => {
      renderCacheStorage();

      await waitFor(() => {
        expect(screen.getByText('/api/data')).toBeInTheDocument();
        expect(screen.getByText('/api/other')).toBeInTheDocument();
        expect(screen.getByText('/image.png')).toBeInTheDocument();
      });
    });

    it('collapses and expands cache on toggle', async () => {
      const user = userEvent.setup();
      renderCacheStorage();

      await waitFor(() => {
        expect(screen.getByText('/api/data')).toBeInTheDocument();
      });

      // Click on test-cache to collapse
      await user.click(screen.getByText('test-cache'));

      // Entries should be hidden
      expect(screen.queryByText('/api/data')).not.toBeInTheDocument();

      // Click again to expand
      await user.click(screen.getByText('test-cache'));

      await waitFor(() => {
        expect(screen.getByText('/api/data')).toBeInTheDocument();
      });
    });

    it('refreshes cache list when Refresh button is clicked', async () => {
      const user = userEvent.setup();
      renderCacheStorage();

      await waitFor(() => {
        expect(screen.getByText('test-cache')).toBeInTheDocument();
      });

      // Clear call counts
      mockCaches.keys.mockClear();

      await user.click(screen.getByRole('button', { name: 'Refresh' }));

      await waitFor(() => {
        expect(mockCaches.keys).toHaveBeenCalled();
      });
    });
  });

  describe('delete cache functionality', () => {
    let mockCaches: ReturnType<typeof setupMockCaches>;

    beforeEach(() => {
      mockCaches = setupMockCaches({
        'test-cache': createMockCache([
          { url: 'https://example.com/api/data', body: 'test data' }
        ])
      });
    });

    it('shows confirmation dialog before deleting cache', async () => {
      const user = userEvent.setup();
      renderCacheStorage();

      await waitFor(() => {
        expect(screen.getByText('test-cache')).toBeInTheDocument();
      });

      // Find and click the delete button for the cache - use getByTitle since there's only one cache
      const deleteButton = screen.getByTitle('Delete cache');
      await user.click(deleteButton);

      await waitFor(() => {
        expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
      });
    });

    it('deletes cache when confirmed', async () => {
      const user = userEvent.setup();
      renderCacheStorage();

      await waitFor(() => {
        expect(screen.getByText('test-cache')).toBeInTheDocument();
      });

      const deleteButton = screen.getByTitle('Delete cache');
      await user.click(deleteButton);

      await waitFor(() => {
        expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('confirm-dialog-confirm'));

      await waitFor(() => {
        expect(mockCaches.delete).toHaveBeenCalledWith('test-cache');
      });
    });

    it('does not delete cache when cancelled', async () => {
      const user = userEvent.setup();
      renderCacheStorage();

      await waitFor(() => {
        expect(screen.getByText('test-cache')).toBeInTheDocument();
      });

      const deleteButton = screen.getByTitle('Delete cache');
      await user.click(deleteButton);

      await waitFor(() => {
        expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('confirm-dialog-cancel'));

      expect(mockCaches.delete).not.toHaveBeenCalled();
    });
  });

  describe('delete entry functionality', () => {
    let testCache: ReturnType<typeof createMockCache>;

    beforeEach(() => {
      testCache = createMockCache([
        { url: 'https://example.com/api/data', body: 'test data' }
      ]);
      setupMockCaches({ 'test-cache': testCache });
    });

    it('shows confirmation dialog before deleting entry', async () => {
      const user = userEvent.setup();
      renderCacheStorage();

      await waitFor(() => {
        expect(screen.getByText('/api/data')).toBeInTheDocument();
      });

      const deleteButton = screen.getByTitle('Delete entry');
      await user.click(deleteButton);

      await waitFor(() => {
        expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
        expect(
          screen.getByText('Are you sure you want to delete this cached entry?')
        ).toBeInTheDocument();
      });
    });

    it('deletes entry when confirmed', async () => {
      const user = userEvent.setup();
      renderCacheStorage();

      await waitFor(() => {
        expect(screen.getByText('/api/data')).toBeInTheDocument();
      });

      const deleteButton = screen.getByTitle('Delete entry');
      await user.click(deleteButton);

      await waitFor(() => {
        expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('confirm-dialog-confirm'));

      await waitFor(() => {
        expect(testCache.delete).toHaveBeenCalledWith(
          'https://example.com/api/data'
        );
      });
    });
  });
});

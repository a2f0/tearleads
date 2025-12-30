import { ThemeProvider } from '@rapid/ui';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

function renderCacheStorage() {
  return render(
    <ThemeProvider>
      <CacheStorage />
    </ThemeProvider>
  );
}

describe('CacheStorage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset window.confirm mock
    vi.spyOn(window, 'confirm').mockReturnValue(true);
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

      expect(screen.getByText('Refresh')).toBeInTheDocument();
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

      await user.click(screen.getByText('Refresh'));

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
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
      const user = userEvent.setup();
      renderCacheStorage();

      await waitFor(() => {
        expect(screen.getByText('test-cache')).toBeInTheDocument();
      });

      // Find and click the delete button for the cache
      const deleteButton = screen.getAllByTitle('Delete cache')[0]!;
      await user.click(deleteButton);

      expect(confirmSpy).toHaveBeenCalledWith(
        'Are you sure you want to delete the cache "test-cache" and all its contents?'
      );
    });

    it('deletes cache when confirmed', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      const user = userEvent.setup();
      renderCacheStorage();

      await waitFor(() => {
        expect(screen.getByText('test-cache')).toBeInTheDocument();
      });

      const deleteButton = screen.getAllByTitle('Delete cache')[0]!;
      await user.click(deleteButton);

      await waitFor(() => {
        expect(mockCaches.delete).toHaveBeenCalledWith('test-cache');
      });
    });

    it('does not delete cache when cancelled', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(false);
      const user = userEvent.setup();
      renderCacheStorage();

      await waitFor(() => {
        expect(screen.getByText('test-cache')).toBeInTheDocument();
      });

      const deleteButton = screen.getAllByTitle('Delete cache')[0]!;
      await user.click(deleteButton);

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
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
      const user = userEvent.setup();
      renderCacheStorage();

      await waitFor(() => {
        expect(screen.getByText('/api/data')).toBeInTheDocument();
      });

      const deleteButton = screen.getAllByTitle('Delete entry')[0]!;
      await user.click(deleteButton);

      expect(confirmSpy).toHaveBeenCalledWith(
        'Are you sure you want to delete this cached entry?'
      );
    });

    it('deletes entry when confirmed', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      const user = userEvent.setup();
      renderCacheStorage();

      await waitFor(() => {
        expect(screen.getByText('/api/data')).toBeInTheDocument();
      });

      const deleteButton = screen.getAllByTitle('Delete entry')[0]!;
      await user.click(deleteButton);

      await waitFor(() => {
        expect(testCache.delete).toHaveBeenCalledWith(
          'https://example.com/api/data'
        );
      });
    });
  });

  describe('Clear All functionality', () => {
    let mockCaches: ReturnType<typeof setupMockCaches>;

    beforeEach(() => {
      mockCaches = setupMockCaches({
        'cache-1': createMockCache([
          { url: 'https://example.com/1', body: 'data 1' }
        ]),
        'cache-2': createMockCache([
          { url: 'https://example.com/2', body: 'data 2' }
        ]),
        'cache-3': createMockCache([
          { url: 'https://example.com/3', body: 'data 3' }
        ])
      });
    });

    it('shows confirmation dialog before clearing all', async () => {
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
      const user = userEvent.setup();
      renderCacheStorage();

      await waitFor(() => {
        expect(screen.getByText('Clear All')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Clear All'));

      expect(confirmSpy).toHaveBeenCalledWith(
        'Are you sure you want to clear ALL cache storage data? This cannot be undone.'
      );
    });

    it('deletes all caches when confirmed', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      const user = userEvent.setup();
      renderCacheStorage();

      await waitFor(() => {
        expect(screen.getByText('Clear All')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Clear All'));

      await waitFor(() => {
        expect(mockCaches.delete).toHaveBeenCalledWith('cache-1');
        expect(mockCaches.delete).toHaveBeenCalledWith('cache-2');
        expect(mockCaches.delete).toHaveBeenCalledWith('cache-3');
      });
    });

    it('does not delete caches when cancelled', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(false);
      const user = userEvent.setup();
      renderCacheStorage();

      await waitFor(() => {
        expect(screen.getByText('Clear All')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Clear All'));

      expect(mockCaches.delete).not.toHaveBeenCalled();
    });

    it('continues deleting other caches when some deletions fail', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      // Make one deletion fail
      mockCaches.delete.mockImplementation((name: string) => {
        if (name === 'cache-2') {
          return Promise.reject(new Error('Deletion failed'));
        }
        return Promise.resolve(true);
      });

      const user = userEvent.setup();
      renderCacheStorage();

      await waitFor(() => {
        expect(screen.getByText('Clear All')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Clear All'));

      // Verify all caches were attempted to be deleted (Promise.allSettled behavior)
      await waitFor(() => {
        expect(mockCaches.delete).toHaveBeenCalledWith('cache-1');
        expect(mockCaches.delete).toHaveBeenCalledWith('cache-2');
        expect(mockCaches.delete).toHaveBeenCalledWith('cache-3');
      });
    });
  });

  describe('loading state', () => {
    it('shows loading spinner while fetching', async () => {
      // Setup with a delay
      const mockCaches = {
        keys: vi
          .fn()
          .mockImplementation(
            () => new Promise((resolve) => setTimeout(() => resolve([]), 100))
          ),
        open: vi.fn(),
        delete: vi.fn()
      };

      Object.defineProperty(window, 'caches', {
        value: mockCaches,
        writable: true,
        configurable: true
      });

      renderCacheStorage();

      expect(screen.getByText('Loading cache contents...')).toBeInTheDocument();
    });
  });

  describe('error handling', () => {
    it('displays error message when fetching fails', async () => {
      const mockCaches = {
        keys: vi.fn().mockRejectedValue(new Error('Network error')),
        open: vi.fn(),
        delete: vi.fn()
      };

      Object.defineProperty(window, 'caches', {
        value: mockCaches,
        writable: true,
        configurable: true
      });

      renderCacheStorage();

      await waitFor(() => {
        expect(screen.getByText('Network error')).toBeInTheDocument();
      });
    });
  });

  describe('URL display', () => {
    it('displays full paths without JavaScript truncation for long URLs', async () => {
      const longPath =
        '/very/long/path/that/exceeds/eighty/characters/and/should/not/be/truncated/by/javascript';

      setupMockCaches({
        'test-cache': createMockCache([
          {
            url: `https://example.com${longPath}`,
            body: 'data'
          }
        ])
      });

      renderCacheStorage();

      await waitFor(() => {
        // Full path should be displayed (CSS handles visual truncation)
        expect(screen.getByText(longPath)).toBeInTheDocument();
      });
    });

    it('extracts pathname from full URL', async () => {
      setupMockCaches({
        'test-cache': createMockCache([
          { url: 'https://example.com/api/data?param=value', body: 'test' }
        ])
      });

      renderCacheStorage();

      await waitFor(() => {
        // Should show pathname + search params, not the full URL
        expect(screen.getByText('/api/data?param=value')).toBeInTheDocument();
      });
    });

    it('shows full URL in title attribute for hover tooltip', async () => {
      const fullUrl = 'https://example.com/some/path';

      setupMockCaches({
        'test-cache': createMockCache([{ url: fullUrl, body: 'data' }])
      });

      renderCacheStorage();

      await waitFor(() => {
        const entryElement = screen.getByText('/some/path').closest('div');
        expect(entryElement).toHaveAttribute('title', fullUrl);
      });
    });
  });
});

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
      const user = userEvent.setup();
      renderCacheStorage();

      await waitFor(() => {
        expect(screen.getByText('Clear All')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Clear All'));

      await waitFor(() => {
        expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
        expect(
          screen.getByText(/Are you sure you want to clear ALL cache storage/)
        ).toBeInTheDocument();
      });
    });

    it('deletes all caches when confirmed', async () => {
      const user = userEvent.setup();
      renderCacheStorage();

      await waitFor(() => {
        expect(screen.getByText('Clear All')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Clear All'));

      await waitFor(() => {
        expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('confirm-dialog-confirm'));

      await waitFor(() => {
        expect(mockCaches.delete).toHaveBeenCalledWith('cache-1');
        expect(mockCaches.delete).toHaveBeenCalledWith('cache-2');
        expect(mockCaches.delete).toHaveBeenCalledWith('cache-3');
      });
    });

    it('does not delete caches when cancelled', async () => {
      const user = userEvent.setup();
      renderCacheStorage();

      await waitFor(() => {
        expect(screen.getByText('Clear All')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Clear All'));

      await waitFor(() => {
        expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('confirm-dialog-cancel'));

      expect(mockCaches.delete).not.toHaveBeenCalled();
    });

    it('continues deleting other caches when some deletions fail', async () => {
      const consoleSpy = mockConsoleError();
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

      await waitFor(() => {
        expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('confirm-dialog-confirm'));

      // Verify all caches were attempted to be deleted (Promise.allSettled behavior)
      await waitFor(() => {
        expect(mockCaches.delete).toHaveBeenCalledWith('cache-1');
        expect(mockCaches.delete).toHaveBeenCalledWith('cache-2');
        expect(mockCaches.delete).toHaveBeenCalledWith('cache-3');
      });
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to delete some caches:',
        expect.any(Array)
      );
      consoleSpy.mockRestore();
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
      const consoleSpy = mockConsoleError();
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
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to read Cache Storage:',
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });
  });

  describe('URL display truncation', () => {
    beforeEach(() => {
      setupMockCaches({
        'test-cache': createMockCache([
          {
            url: 'https://example.com/very/long/path/that/exceeds/eighty/characters/and/should/be/truncated/appropriately',
            body: 'data'
          }
        ])
      });
    });

    it('truncates long URLs', async () => {
      renderCacheStorage();

      await waitFor(() => {
        // Should show truncated path ending with ...
        const truncatedPath = screen.getByText(/\.\.\.$/);
        expect(truncatedPath).toBeInTheDocument();
      });
    });
  });
});

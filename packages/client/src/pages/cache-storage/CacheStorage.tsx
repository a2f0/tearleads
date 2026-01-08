import { Database, Loader2, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { RefreshButton } from '@/components/ui/refresh-button';
import { formatFileSize } from '@/lib/utils';
import {
  type CacheEntry,
  type CacheInfo,
  CacheTreeNode
} from './CacheTreeNode';

async function getCacheInfo(cache: Cache, name: string): Promise<CacheInfo> {
  const keys = await cache.keys();

  // Process entries in parallel for better performance
  const entryPromises = keys.map(async (request) => {
    const response = await cache.match(request);
    if (!response) {
      return null;
    }

    let size = 0;
    const contentLength = response.headers.get('Content-Length');
    if (contentLength) {
      const parsedSize = parseInt(contentLength, 10);
      if (!Number.isNaN(parsedSize)) {
        size = parsedSize;
      }
    } else {
      // Clone and read as blob to get size
      try {
        const blob = await response.clone().blob();
        size = blob.size;
      } catch {
        // Ignore if we can't read the size
      }
    }
    return { url: request.url, size };
  });

  const entries = (await Promise.all(entryPromises)).filter(
    (e): e is CacheEntry => e !== null
  );
  const totalSize = entries.reduce((sum, entry) => sum + entry.size, 0);

  // Sort entries alphabetically by URL
  entries.sort((a, b) => a.url.localeCompare(b.url));

  return { name, entries, totalSize };
}

export function CacheStorage() {
  const [caches, setCaches] = useState<CacheInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);
  const [expandedCaches, setExpandedCaches] = useState<Set<string>>(new Set());
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = () => setRefreshKey((k) => k + 1);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey is intentionally used as a trigger
  useEffect(() => {
    let isCancelled = false;

    const fetchCacheContents = async () => {
      setLoading(true);
      setError(null);

      try {
        if (!('caches' in window)) {
          if (!isCancelled) {
            setSupported(false);
            setLoading(false);
          }
          return;
        }

        const cacheNames = await window.caches.keys();

        // Fetch all cache info in parallel for better performance
        const cacheInfos = await Promise.all(
          cacheNames.map(async (name) => {
            const cache = await window.caches.open(name);
            return getCacheInfo(cache, name);
          })
        );

        // Sort caches alphabetically
        cacheInfos.sort((a, b) => a.name.localeCompare(b.name));

        if (!isCancelled) {
          setCaches(cacheInfos);
          // Expand all caches by default
          setExpandedCaches(new Set(cacheInfos.map((c) => c.name)));
        }
      } catch (err) {
        console.error('Failed to read Cache Storage:', err);
        if (!isCancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!isCancelled) {
          setLoading(false);
        }
      }
    };

    fetchCacheContents();

    return () => {
      isCancelled = true;
    };
  }, [refreshKey]);

  const handleToggle = (cacheName: string) => {
    setExpandedCaches((prev) => {
      const next = new Set(prev);
      if (next.has(cacheName)) {
        next.delete(cacheName);
      } else {
        next.add(cacheName);
      }
      return next;
    });
  };

  const handleDeleteCache = async (cacheName: string) => {
    if (
      !window.confirm(
        `Are you sure you want to delete the cache "${cacheName}" and all its contents?`
      )
    ) {
      return;
    }

    try {
      await window.caches.delete(cacheName);
      refresh();
    } catch (err) {
      console.error('Failed to delete cache:', err);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDeleteEntry = async (cacheName: string, url: string) => {
    if (!window.confirm(`Are you sure you want to delete this cached entry?`)) {
      return;
    }

    try {
      const cache = await window.caches.open(cacheName);
      await cache.delete(url);
      refresh();
    } catch (err) {
      console.error('Failed to delete cache entry:', err);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleClearAll = async () => {
    if (
      !window.confirm(
        'Are you sure you want to clear ALL cache storage data? This cannot be undone.'
      )
    ) {
      return;
    }

    try {
      const cacheNames = await window.caches.keys();
      const results = await Promise.allSettled(
        cacheNames.map((name) => window.caches.delete(name))
      );

      const failed = results.filter((r) => r.status === 'rejected');

      if (failed.length > 0) {
        console.error('Failed to delete some caches:', failed);
        setError(
          `Failed to delete ${failed.length} cache(s). See console for details.`
        );
      }

      refresh();
    } catch (err) {
      console.error('Failed to clear cache storage:', err);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const totalSize = caches.reduce((sum, c) => sum + c.totalSize, 0);
  const totalEntries = caches.reduce((sum, c) => sum + c.entries.length, 0);

  if (!supported) {
    return (
      <div className="space-y-6">
        <h1 className="font-bold text-2xl tracking-tight">
          Cache Storage Browser
        </h1>
        <div className="rounded-lg border p-8 text-center">
          <Database className="mx-auto h-12 w-12 text-muted-foreground/50" />
          <p className="mt-4 text-muted-foreground">
            Cache Storage API is not supported in this browser.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-bold text-2xl tracking-tight">
            Cache Storage Browser
          </h1>
          {caches.length > 0 && (
            <p className="text-muted-foreground text-sm">
              {caches.length} cache{caches.length !== 1 ? 's' : ''},{' '}
              {totalEntries} total entries ({formatFileSize(totalSize)})
            </p>
          )}
        </div>
        <div className="flex gap-2">
          {caches.length > 0 && (
            <Button variant="destructive" size="sm" onClick={handleClearAll}>
              <Trash2 className="mr-2 h-4 w-4" />
              Clear All
            </Button>
          )}
          <RefreshButton onClick={refresh} loading={loading} />
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive">
          {error}
        </div>
      )}

      <div className="rounded-lg border">
        {loading && caches.length === 0 ? (
          <div className="flex items-center justify-center p-8 text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            Loading cache contents...
          </div>
        ) : caches.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            <Database className="mx-auto h-12 w-12 text-muted-foreground/50" />
            <p className="mt-4">Cache Storage is empty.</p>
            <p className="mt-2 text-sm">
              LLM models and other cached resources will appear here.
            </p>
          </div>
        ) : (
          <div className="py-2">
            {caches.map((cache) => (
              <CacheTreeNode
                key={cache.name}
                cache={cache}
                isExpanded={expandedCaches.has(cache.name)}
                onToggle={() => handleToggle(cache.name)}
                onDeleteCache={handleDeleteCache}
                onDeleteEntry={handleDeleteEntry}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

import {
  ChevronDown,
  ChevronRight,
  Database,
  FileIcon,
  FolderIcon,
  FolderOpen,
  Loader2,
  RefreshCw,
  Trash2
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { formatFileSize } from '@/lib/utils';

interface CacheEntry {
  url: string;
  size: number;
}

interface CacheInfo {
  name: string;
  entries: CacheEntry[];
  totalSize: number;
}

interface CacheTreeNodeProps {
  cache: CacheInfo;
  isExpanded: boolean;
  onToggle: () => void;
  onDeleteCache: (name: string) => void;
  onDeleteEntry: (cacheName: string, url: string) => void;
}

interface DeleteButtonProps {
  onClick: () => void;
  title?: string;
}

function DeleteButton({ onClick, title = 'Delete' }: DeleteButtonProps) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-6 w-6 opacity-0 group-hover:opacity-100"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={title}
    >
      <Trash2 className="h-3 w-3" />
    </Button>
  );
}

function getDisplayUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // Show just the pathname and search params, truncated if needed
    const path = parsed.pathname + parsed.search;
    return path.length > 80 ? `${path.substring(0, 77)}...` : path;
  } catch {
    return url.length > 80 ? `${url.substring(0, 77)}...` : url;
  }
}

function CacheTreeNode({
  cache,
  isExpanded,
  onToggle,
  onDeleteCache,
  onDeleteEntry
}: CacheTreeNodeProps) {
  const hasEntries = cache.entries.length > 0;

  return (
    <div>
      <div className="group flex items-center gap-2 rounded px-2 py-1 hover:bg-accent">
        <button
          type="button"
          className="flex flex-1 cursor-pointer items-center gap-2 text-left"
          onClick={onToggle}
          aria-expanded={hasEntries ? isExpanded : undefined}
        >
          {hasEntries ? (
            isExpanded ? (
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            )
          ) : (
            <span className="w-4" />
          )}
          {isExpanded ? (
            <FolderOpen className="h-4 w-4 shrink-0 text-blue-500" />
          ) : (
            <FolderIcon className="h-4 w-4 shrink-0 text-blue-500" />
          )}
          <span className="truncate font-medium text-sm">{cache.name}</span>
          <span className="ml-auto shrink-0 text-muted-foreground text-xs">
            {cache.entries.length} items ({formatFileSize(cache.totalSize)})
          </span>
        </button>
        <DeleteButton
          onClick={() => onDeleteCache(cache.name)}
          title="Delete cache"
        />
      </div>
      {isExpanded && hasEntries && (
        <div>
          {cache.entries.map((entry) => (
            <div
              key={entry.url}
              className="group flex items-center gap-2 rounded py-1 pr-2 pl-10 hover:bg-accent"
              title={entry.url}
            >
              <FileIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate font-mono text-xs">
                {getDisplayUrl(entry.url)}
              </span>
              <span className="ml-auto shrink-0 text-muted-foreground text-xs">
                {formatFileSize(entry.size)}
              </span>
              <DeleteButton
                onClick={() => onDeleteEntry(cache.name, entry.url)}
                title="Delete entry"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

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
        <Button
          variant="outline"
          size="sm"
          onClick={refresh}
          disabled={loading}
        >
          <RefreshCw
            className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`}
          />
          Refresh
        </Button>
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

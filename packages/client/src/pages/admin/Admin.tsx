import type { RedisKeyInfo } from '@rapid/shared';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Database, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshButton } from '@/components/ui/refresh-button';
import { api } from '@/lib/api';
import { RedisKeyRow } from './RedisKeyRow';

const PAGE_SIZE = 50;
const ROW_HEIGHT_ESTIMATE = 48;

export function Admin() {
  const [keys, setKeys] = useState<RedisKeyInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [hasMore, setHasMore] = useState(false);

  const cursorRef = useRef<string>('0');
  const parentRef = useRef<HTMLDivElement>(null);

  const fetchKeys = useCallback(async (reset = true) => {
    if (reset) {
      setLoading(true);
      setKeys([]);
      cursorRef.current = '0';
    } else {
      setLoadingMore(true);
    }
    setError(null);

    try {
      const currentCursor = reset ? '0' : cursorRef.current;
      const response = await api.admin.redis.getKeys(currentCursor, PAGE_SIZE);

      if (reset) {
        setKeys(response.keys);
      } else {
        setKeys((prev) => [...prev, ...response.keys]);
      }
      cursorRef.current = response.cursor;
      setHasMore(response.hasMore);
    } catch (err) {
      console.error('Failed to fetch Redis keys:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    fetchKeys(true);
  }, [fetchKeys]);

  const virtualizer = useVirtualizer({
    count: keys.length + (hasMore ? 1 : 0),
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT_ESTIMATE,
    overscan: 5
  });

  const virtualItems = virtualizer.getVirtualItems();

  // Load more when scrolling near the end
  useEffect(() => {
    if (!hasMore || loadingMore || loading || virtualItems.length === 0) return;

    const lastItem = virtualItems[virtualItems.length - 1];
    if (lastItem && lastItem.index >= keys.length - 5) {
      fetchKeys(false);
    }
  }, [virtualItems, hasMore, loadingMore, loading, keys.length, fetchKeys]);

  const handleToggle = (key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleRefresh = () => {
    fetchKeys(true);
  };

  const keyCount = keys.length;
  const keyLabel = keyCount === 1 ? 'key' : 'keys';

  return (
    <div className="flex h-full flex-col space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-bold text-2xl tracking-tight">Admin</h1>
          <p className="text-muted-foreground text-sm">Redis Browser</p>
        </div>
        <RefreshButton onClick={handleRefresh} loading={loading} />
      </div>

      {error && (
        <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive">
          {error}
        </div>
      )}

      <div className="min-h-0 flex-1">
        <p className="mb-2 text-muted-foreground text-sm">
          {keyCount} {keyLabel}
          {hasMore && '+'}
        </p>
        <div className="h-[calc(100vh-280px)] rounded-lg border">
          {loading && keys.length === 0 ? (
            <div className="flex items-center justify-center p-8 text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Loading Redis keys...
            </div>
          ) : keys.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-8 text-muted-foreground">
              <Database className="mb-2 h-8 w-8" />
              <p>No keys found.</p>
            </div>
          ) : (
            <div ref={parentRef} className="h-full overflow-auto">
              <div
                className="relative w-full"
                style={{ height: `${virtualizer.getTotalSize()}px` }}
              >
                {virtualItems.map((virtualItem) => {
                  const isLoaderRow = virtualItem.index >= keys.length;

                  if (isLoaderRow) {
                    return (
                      <div
                        key="loader"
                        className="absolute top-0 left-0 flex w-full items-center justify-center p-4 text-muted-foreground"
                        style={{
                          height: `${virtualItem.size}px`,
                          transform: `translateY(${virtualItem.start}px)`
                        }}
                      >
                        {loadingMore && (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Loading more...
                          </>
                        )}
                      </div>
                    );
                  }

                  const keyInfo = keys[virtualItem.index];
                  if (!keyInfo) return null;

                  return (
                    <div
                      key={keyInfo.key}
                      data-index={virtualItem.index}
                      ref={virtualizer.measureElement}
                      className="absolute top-0 left-0 w-full"
                      style={{
                        transform: `translateY(${virtualItem.start}px)`
                      }}
                    >
                      <RedisKeyRow
                        keyInfo={keyInfo}
                        isExpanded={expandedKeys.has(keyInfo.key)}
                        onToggle={() => handleToggle(keyInfo.key)}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

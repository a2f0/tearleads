import type { RedisKeyInfo } from '@rapid/shared';
import { Database, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshButton } from '@/components/ui/refresh-button';
import { api } from '@/lib/api';
import { RedisKeyRow } from './RedisKeyRow';

const PAGE_SIZE = 50;

export function Admin() {
  const [keys, setKeys] = useState<RedisKeyInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [hasMore, setHasMore] = useState(false);

  const cursorRef = useRef<string>('0');
  const sentinelRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (!hasMore || loadingMore || loading) return;

    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore && !loadingMore) {
          fetchKeys(false);
        }
      },
      { rootMargin: '100px' }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, loading, fetchKeys]);

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
    <div className="space-y-6">
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

      <div>
        <p className="mb-2 text-muted-foreground text-sm">
          {keyCount} {keyLabel}
          {hasMore && '+'}
        </p>
        <div className="rounded-lg border">
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
            <>
              {keys.map((keyInfo) => (
                <RedisKeyRow
                  key={keyInfo.key}
                  keyInfo={keyInfo}
                  isExpanded={expandedKeys.has(keyInfo.key)}
                  onToggle={() => handleToggle(keyInfo.key)}
                />
              ))}
              {hasMore && (
                <div
                  ref={sentinelRef}
                  className="flex items-center justify-center p-4 text-muted-foreground"
                >
                  {loadingMore && (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Loading more...
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

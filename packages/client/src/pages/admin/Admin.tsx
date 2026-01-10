import type { RedisKeyInfo } from '@rapid/shared';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Database, Loader2, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ContextMenu, ContextMenuItem } from '@/components/ui/context-menu';
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
  const [contextMenu, setContextMenu] = useState<{
    keyInfo: RedisKeyInfo;
    x: number;
    y: number;
  } | null>(null);
  const [totalCount, setTotalCount] = useState<number | null>(null);

  const cursorRef = useRef<string>('0');
  const parentRef = useRef<HTMLDivElement>(null);

  const fetchTotalCount = useCallback(async () => {
    try {
      const response = await api.admin.redis.getDbSize();
      setTotalCount(response.count);
    } catch (err) {
      console.error('Failed to fetch Redis db size:', err);
    }
  }, []);

  const fetchKeys = useCallback(
    async (reset = true) => {
      if (reset) {
        setLoading(true);
        setKeys([]);
        cursorRef.current = '0';
        fetchTotalCount();
      } else {
        setLoadingMore(true);
      }
      setError(null);

      try {
        const currentCursor = reset ? '0' : cursorRef.current;
        const response = await api.admin.redis.getKeys(
          currentCursor,
          PAGE_SIZE
        );

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
    },
    [fetchTotalCount]
  );

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

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, keyInfo: RedisKeyInfo) => {
      e.preventDefault();
      setContextMenu({ keyInfo, x: e.clientX, y: e.clientY });
    },
    []
  );

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleDeleteKey = useCallback(async () => {
    if (!contextMenu) return;

    const keyToDelete = contextMenu.keyInfo.key;
    setContextMenu(null);

    try {
      const result = await api.admin.redis.deleteKey(keyToDelete);
      if (result.deleted) {
        setKeys((prev) => prev.filter((k) => k.key !== keyToDelete));
        setExpandedKeys((prev) => {
          const next = new Set(prev);
          next.delete(keyToDelete);
          return next;
        });
        setTotalCount((prev) => (prev !== null ? prev - 1 : null));
      }
    } catch (err) {
      console.error('Failed to delete key:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete key');
    }
  }, [contextMenu]);

  const keyCount = keys.length;

  // Calculate visible range from virtual items (excluding loader row)
  const visibleKeyItems = virtualItems.filter(
    (item) => item.index < keys.length
  );
  const firstVisible =
    visibleKeyItems.length > 0 ? visibleKeyItems[0]?.index : null;
  const lastVisible =
    visibleKeyItems.length > 0
      ? visibleKeyItems[visibleKeyItems.length - 1]?.index
      : null;

  const getStatusText = () => {
    if (totalCount === null) {
      return `${keyCount} loaded${hasMore ? '+' : ''}`;
    }
    if (
      firstVisible !== null &&
      firstVisible !== undefined &&
      lastVisible !== null &&
      lastVisible !== undefined &&
      keyCount > 0
    ) {
      return `Viewing ${firstVisible + 1}-${lastVisible + 1} of ${keyCount} loaded (${totalCount} total)`;
    }
    return `${keyCount} loaded of ${totalCount} total`;
  };

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
        <p className="mb-2 text-muted-foreground text-sm">{getStatusText()}</p>
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
                        onContextMenu={(e) => handleContextMenu(e, keyInfo)}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={handleCloseContextMenu}
        >
          <ContextMenuItem
            icon={<Trash2 className="h-4 w-4" />}
            onClick={handleDeleteKey}
          >
            Delete
          </ContextMenuItem>
        </ContextMenu>
      )}
    </div>
  );
}

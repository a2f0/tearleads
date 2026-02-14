import type { VirtualItem } from '@tanstack/react-virtual';
import { Loader2 } from 'lucide-react';
import type { RefObject } from 'react';
import { VirtualListStatus } from '@/components/ui/VirtualListStatus';

interface TableRowsDocumentViewProps {
  parentRef: RefObject<HTMLDivElement | null>;
  showInlineStatus: boolean;
  firstVisible: number | null;
  lastVisible: number | null;
  rows: Record<string, unknown>[];
  totalCount: number | null;
  hasMore: boolean;
  loading: boolean;
  totalSize: number;
  virtualItems: VirtualItem[];
  measureElement: (element: HTMLDivElement | null) => void;
  getRowKey: (row: Record<string, unknown>, index: number) => string;
  loadingMore: boolean;
}

export function TableRowsDocumentView({
  parentRef,
  showInlineStatus,
  firstVisible,
  lastVisible,
  rows,
  totalCount,
  hasMore,
  loading,
  totalSize,
  virtualItems,
  measureElement,
  getRowKey,
  loadingMore
}: TableRowsDocumentViewProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-lg border">
      <div
        ref={parentRef}
        className="min-h-0 flex-1 overflow-auto p-2"
        data-testid="scroll-container"
      >
        {showInlineStatus && (
          <div className="sticky top-0 z-10 bg-background pb-2">
            <VirtualListStatus
              firstVisible={firstVisible}
              lastVisible={lastVisible}
              loadedCount={rows.length}
              totalCount={totalCount}
              hasMore={hasMore}
              itemLabel="row"
            />
          </div>
        )}
        {rows.length === 0 && !loading ? (
          <div className="p-8 text-center text-muted-foreground">
            No rows in this table
          </div>
        ) : (
          <div className="relative w-full" style={{ height: `${totalSize}px` }}>
            {virtualItems.map((virtualItem) => {
              const isLoaderRow = virtualItem.index >= rows.length;

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

              const row = rows[virtualItem.index];
              if (!row) return null;

              return (
                <div
                  key={getRowKey(row, virtualItem.index)}
                  data-index={virtualItem.index}
                  ref={measureElement}
                  className="absolute top-0 left-0 w-full pb-2"
                  style={{
                    transform: `translateY(${virtualItem.start}px)`
                  }}
                >
                  <pre className="overflow-x-auto rounded-lg border bg-muted/30 p-4 font-mono text-sm">
                    {JSON.stringify(row, null, 2)}
                  </pre>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

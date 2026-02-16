import { Loader2 } from 'lucide-react';
import type { RefObject } from 'react';
import { getRowKey } from './PostgresTableUtils';

interface DocumentViewProps {
  parentRef: RefObject<HTMLDivElement | null>;
  virtualizer: any;
  rows: Record<string, unknown>[];
  loadingMore: boolean;
  stickyStatus: React.ReactNode;
}

export function DocumentView({
  parentRef,
  virtualizer,
  rows,
  loadingMore,
  stickyStatus
}: DocumentViewProps) {
  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div
      ref={parentRef}
      className="min-h-0 flex-1 overflow-auto rounded-lg border"
      data-testid="scroll-container"
    >
      {stickyStatus}
      <div
        style={{ height: `${virtualizer.getTotalSize()}px` }}
        className="relative w-full"
      >
        {virtualItems.map((virtualItem: any) => {
          const isLoaderRow = virtualItem.index >= rows.length;

          if (isLoaderRow) {
            return (
              <div
                key="loader"
                className="absolute top-0 left-0 flex w-full items-center justify-center p-4 text-muted-foreground"
                style={{
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
              key={getRowKey(virtualItem.index)}
              data-index={virtualItem.index}
              ref={virtualizer.measureElement}
              className="absolute top-0 left-0 w-full p-2"
              style={{
                transform: `translateY(${virtualItem.start}px)`
              }}
            >
              <pre className="overflow-x-auto rounded border bg-muted/50 p-3 font-mono text-xs">
                {JSON.stringify(row, null, 2)}
              </pre>
            </div>
          );
        })}
      </div>
    </div>
  );
}

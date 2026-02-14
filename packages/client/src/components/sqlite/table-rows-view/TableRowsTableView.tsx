import type { VirtualItem } from '@tanstack/react-virtual';
import { ArrowDown, ArrowUp, ArrowUpDown, Loader2 } from 'lucide-react';
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  RefObject
} from 'react';
import type { ColumnInfo } from '@/components/sqlite/exportTableCsv';
import { VirtualListStatus } from '@/components/ui/VirtualListStatus';
import { cn } from '@/lib/utils';

interface TableRowsTableViewProps {
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
  visibleColumns: ColumnInfo[];
  columnWidths: Record<string, number>;
  sortColumn: string | null;
  sortDirection: 'asc' | 'desc' | null;
  onSort: (columnName: string) => void;
  resizingColumn: string | null;
  onResizeStart: (
    column: string,
    event: ReactMouseEvent<HTMLDivElement>
  ) => void;
  onKeyboardResize: (column: string, event: ReactKeyboardEvent) => void;
  getRowKey: (row: Record<string, unknown>, index: number) => string;
  formatCellValue: (value: unknown) => string;
  loadingMore: boolean;
}

export function TableRowsTableView({
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
  visibleColumns,
  columnWidths,
  sortColumn,
  sortDirection,
  onSort,
  resizingColumn,
  onResizeStart,
  onKeyboardResize,
  getRowKey,
  formatCellValue,
  loadingMore
}: TableRowsTableViewProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border">
      <div
        className="grid border-b bg-muted/50"
        style={{
          gridTemplateColumns: visibleColumns
            .map((col) =>
              columnWidths[col.name]
                ? `${columnWidths[col.name]}px`
                : 'minmax(100px, 1fr)'
            )
            .join(' ')
        }}
      >
        {visibleColumns.map((col) => (
          <div
            key={col.name}
            className="group relative px-4 py-3 text-left font-medium text-muted-foreground text-xs uppercase tracking-wider"
          >
            <button
              type="button"
              onClick={() => onSort(col.name)}
              className="inline-flex items-center gap-1 hover:text-foreground"
              data-testid={`sort-${col.name}`}
            >
              {col.name}
              {col.pk > 0 && <span className="text-primary">PK</span>}
              {sortColumn === col.name ? (
                sortDirection === 'asc' ? (
                  <ArrowUp className="h-3 w-3" />
                ) : (
                  <ArrowDown className="h-3 w-3" />
                )
              ) : (
                <ArrowUpDown className="h-3 w-3 opacity-50" />
              )}
            </button>
            {/* biome-ignore lint/a11y/useSemanticElements: vertical separator for column resize, hr is not appropriate */}
            <div
              role="separator"
              aria-orientation="vertical"
              aria-valuenow={columnWidths[col.name] || 150}
              aria-label={`Resize ${col.name} column`}
              tabIndex={0}
              className={cn(
                'absolute top-0 right-0 h-full w-1 cursor-col-resize bg-border opacity-0 transition-opacity hover:opacity-100 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-primary group-hover:opacity-50',
                resizingColumn === col.name && 'opacity-100'
              )}
              onMouseDown={(event) => onResizeStart(col.name, event)}
              onKeyDown={(event) => onKeyboardResize(col.name, event)}
            />
          </div>
        ))}
      </div>

      <div
        ref={parentRef}
        className="min-h-0 flex-1 overflow-auto"
        data-testid="scroll-container"
      >
        {showInlineStatus && (
          <div className="sticky top-0 z-10 bg-background px-4 py-2">
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
          <div className="px-4 py-8 text-center text-muted-foreground">
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
                    className="absolute top-0 left-0 flex w-full items-center justify-center border-b p-4 text-muted-foreground"
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
                  className="absolute top-0 left-0 grid w-full border-b hover:bg-muted/25"
                  style={{
                    gridTemplateColumns: visibleColumns
                      .map((col) =>
                        columnWidths[col.name]
                          ? `${columnWidths[col.name]}px`
                          : 'minmax(100px, 1fr)'
                      )
                      .join(' '),
                    transform: `translateY(${virtualItem.start}px)`
                  }}
                >
                  {visibleColumns.map((col) => (
                    <div
                      key={col.name}
                      className={cn(
                        'truncate whitespace-nowrap px-4 py-2 font-mono text-sm',
                        row[col.name] === null && 'text-muted-foreground italic'
                      )}
                    >
                      {formatCellValue(row[col.name])}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

import type { useVirtualizer } from '@tanstack/react-virtual';
import type { PostgresColumnInfo } from '@tearleads/shared';
import {
  WINDOW_TABLE_TYPOGRAPHY,
  WindowTableRow
} from '@tearleads/window-manager';
import { ArrowDown, ArrowUp, ArrowUpDown, Loader2 } from 'lucide-react';
import type { RefObject } from 'react';
import { formatCellValue, getRowKey } from './PostgresTableUtils';
import type { SortState } from './usePostgresTableData';

interface TableViewProps {
  parentRef: RefObject<HTMLDivElement | null>;
  virtualizer: ReturnType<typeof useVirtualizer>;
  rows: Record<string, unknown>[];
  visibleColumns: PostgresColumnInfo[];
  sort: SortState;
  handleSort: (columnName: string) => void;
  loadingMore: boolean;
  stickyStatus: React.ReactNode;
}

export function TableView({
  parentRef,
  virtualizer,
  rows,
  visibleColumns,
  sort,
  handleSort,
  loadingMore,
  stickyStatus
}: TableViewProps) {
  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div
      ref={parentRef}
      className="min-h-0 flex-1 overflow-auto rounded-lg border"
      data-testid="scroll-container"
    >
      {stickyStatus}
      <table className={`${WINDOW_TABLE_TYPOGRAPHY.table} border-collapse`}>
        <thead className="sticky top-[2.25rem] z-10 bg-muted">
          <tr>
            {visibleColumns.map((col) => (
              <th
                key={col.name}
                className={`${WINDOW_TABLE_TYPOGRAPHY.headerCell} cursor-pointer hover:bg-muted/80`}
                onClick={() => handleSort(col.name)}
              >
                <div className="flex items-center gap-1">
                  <span className="truncate">{col.name}</span>
                  {sort.column === col.name ? (
                    sort.direction === 'asc' ? (
                      <ArrowUp className="h-4 w-4 shrink-0" />
                    ) : (
                      <ArrowDown className="h-4 w-4 shrink-0" />
                    )
                  ) : (
                    <ArrowUpDown className="h-4 w-4 shrink-0 text-muted-foreground/50" />
                  )}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {virtualItems.map((virtualItem) => {
            const isLoaderRow = virtualItem.index >= rows.length;

            if (isLoaderRow) {
              return (
                <WindowTableRow
                  key="loader"
                  className="cursor-default border-b-0 hover:bg-transparent"
                >
                  <td
                    colSpan={visibleColumns.length}
                    className={`${WINDOW_TABLE_TYPOGRAPHY.mutedCell} p-4 text-center`}
                  >
                    {loadingMore && (
                      <span className="flex items-center justify-center">
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Loading more...
                      </span>
                    )}
                  </td>
                </WindowTableRow>
              );
            }

            const row = rows[virtualItem.index];
            if (!row) return null;

            return (
              <WindowTableRow
                key={getRowKey(virtualItem.index)}
                className="cursor-default hover:bg-muted/50"
              >
                {visibleColumns.map((col) => (
                  <td
                    key={col.name}
                    className={`${WINDOW_TABLE_TYPOGRAPHY.cell} max-w-xs truncate font-mono text-sm`}
                    title={formatCellValue(row[col.name])}
                  >
                    {formatCellValue(row[col.name])}
                  </td>
                ))}
              </WindowTableRow>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

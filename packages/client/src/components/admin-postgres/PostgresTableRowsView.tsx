import { useVirtualizer } from '@tanstack/react-virtual';
import type { PostgresColumnInfo } from '@tearleads/shared';
import { WINDOW_TABLE_TYPOGRAPHY, WindowTableRow } from '@tearleads/window-manager';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Braces,
  Download,
  Loader2,
  Settings
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { RefreshButton } from '@/components/ui/refresh-button';
import { VirtualListStatus } from '@/components/ui/VirtualListStatus';
import { api } from '@/lib/api';
import { createCsv } from '@/lib/csv';

function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

const PAGE_SIZE = 50;
const ROW_HEIGHT_ESTIMATE = 40;
const MOBILE_BREAKPOINT = 640;
const DEFAULT_CONTAINER_CLASSNAME =
  'flex flex-1 min-h-0 flex-col space-y-4 overflow-hidden';

function isMobileViewport(): boolean {
  return typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT;
}

type SortDirection = 'asc' | 'desc' | null;

interface SortState {
  column: string | null;
  direction: SortDirection;
}

interface PostgresTableRowsViewProps {
  schema: string | null;
  tableName: string | null;
  backLink?: ReactNode;
  containerClassName?: string;
}

function formatCellValue(value: unknown): string {
  if (value === null) return 'NULL';
  if (value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function getRowKey(index: number): string {
  // Use index-based key for Postgres (no PK info in our column response)
  return `idx-${index}`;
}

export function PostgresTableRowsView({
  schema,
  tableName,
  backLink,
  containerClassName = DEFAULT_CONTAINER_CLASSNAME
}: PostgresTableRowsViewProps) {
  const [columns, setColumns] = useState<PostgresColumnInfo[]>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const offsetRef = useRef<number>(0);
  const parentRef = useRef<HTMLDivElement>(null);
  const [documentView, setDocumentView] = useState(isMobileViewport);
  const userToggledViewRef = useRef(false);
  const [sort, setSort] = useState<SortState>({
    column: null,
    direction: null
  });
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(
    new Set(['id'])
  );
  const [showColumnSettings, setShowColumnSettings] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);

  const [initialLoadComplete, setInitialLoadComplete] = useState(false);
  const isLoadingMoreRef = useRef(false);
  const [hasScrolled, setHasScrolled] = useState(false);

  // Local component to reduce duplication of sticky VirtualListStatus
  const StickyVirtualListStatus = ({
    firstVisible,
    lastVisible
  }: {
    firstVisible: number | null;
    lastVisible: number | null;
  }) => (
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
  );

  const fetchTableData = useCallback(
    async (reset = true) => {
      if (!schema || !tableName) return;

      setError(null);
      if (reset) {
        setLoading(true);
        setRows([]);
        offsetRef.current = 0;
        setInitialLoadComplete(false);
        isLoadingMoreRef.current = false;
        setHasScrolled(false);
      } else {
        if (isLoadingMoreRef.current) return;
        isLoadingMoreRef.current = true;
        setLoadingMore(true);
      }

      try {
        // Fetch columns on initial load
        if (reset) {
          const columnsResponse = await api.admin.postgres.getColumns(
            schema,
            tableName
          );
          setColumns(columnsResponse.columns);
        }

        // Fetch rows
        const rowsOptions: {
          limit: number;
          offset: number;
          sortColumn?: string;
          sortDirection?: 'asc' | 'desc';
        } = {
          limit: PAGE_SIZE,
          offset: reset ? 0 : offsetRef.current
        };
        if (sort.column) rowsOptions.sortColumn = sort.column;
        if (sort.direction) rowsOptions.sortDirection = sort.direction;

        const rowsResponse = await api.admin.postgres.getRows(
          schema,
          tableName,
          rowsOptions
        );

        if (reset) {
          setRows(rowsResponse.rows);
        } else {
          setRows((prev) => [...prev, ...rowsResponse.rows]);
        }

        setTotalCount(rowsResponse.totalCount);
        offsetRef.current += rowsResponse.rows.length;
        setHasMore(offsetRef.current < rowsResponse.totalCount);
      } catch (err) {
        console.error('Failed to fetch Postgres table data:', err);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
        setLoadingMore(false);
        if (reset) {
          setInitialLoadComplete(true);
        }
        isLoadingMoreRef.current = false;
      }
    },
    [schema, tableName, sort.column, sort.direction]
  );

  // Fetch data on mount and when dependencies change
  useEffect(() => {
    fetchTableData(true);
  }, [fetchTableData]);

  // Close column settings when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        settingsRef.current &&
        !settingsRef.current.contains(event.target as Node)
      ) {
        setShowColumnSettings(false);
      }
    };

    if (showColumnSettings) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showColumnSettings]);

  // Responsive view toggle
  useEffect(() => {
    if (userToggledViewRef.current) return;

    const handleResize = () => {
      setDocumentView(isMobileViewport());
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const visibleColumns = useMemo(
    () => columns.filter((col) => !hiddenColumns.has(col.name)),
    [columns, hiddenColumns]
  );

  const virtualizer = useVirtualizer({
    count: rows.length + (hasMore ? 1 : 0),
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT_ESTIMATE,
    overscan: 5
  });

  const virtualItems = virtualizer.getVirtualItems();

  // Load more when scrolling near end
  useEffect(() => {
    if (!initialLoadComplete || !hasMore || loadingMore || loading) return;
    if (!hasScrolled) return;

    const lastItem = virtualItems[virtualItems.length - 1];
    if (lastItem && lastItem.index >= rows.length - 5 && rows.length > 0) {
      fetchTableData(false);
    }
  }, [
    virtualItems,
    hasMore,
    loadingMore,
    loading,
    rows.length,
    fetchTableData,
    initialLoadComplete,
    hasScrolled
  ]);

  // Track scroll
  useEffect(() => {
    const scrollElement = parentRef.current;
    if (!scrollElement) return;

    const handleScroll = () => {
      if (scrollElement.scrollTop > 0) {
        setHasScrolled(true);
      }
    };

    scrollElement.addEventListener('scroll', handleScroll, { passive: true });
    return () => scrollElement.removeEventListener('scroll', handleScroll);
  }, []);

  const handleSort = (columnName: string) => {
    setSort((prev) => {
      if (prev.column === columnName) {
        if (prev.direction === 'asc') {
          return { column: columnName, direction: 'desc' };
        } else if (prev.direction === 'desc') {
          return { column: null, direction: null };
        }
      }
      return { column: columnName, direction: 'asc' };
    });
  };

  const handleToggleColumn = (columnName: string) => {
    setHiddenColumns((prev) => {
      const next = new Set(prev);
      if (next.has(columnName)) {
        next.delete(columnName);
      } else {
        next.add(columnName);
      }
      return next;
    });
  };

  const handleToggleView = () => {
    userToggledViewRef.current = true;
    setDocumentView((prev) => !prev);
  };

  const handleExportCsv = useCallback(async () => {
    if (!schema || !tableName || exporting) return;

    setExporting(true);
    try {
      // Fetch all rows for export
      const allRows: Record<string, unknown>[] = [];
      let offset = 0;
      let hasMoreData = true;

      while (hasMoreData) {
        const exportOptions: {
          limit: number;
          offset: number;
          sortColumn?: string;
          sortDirection?: 'asc' | 'desc';
        } = { limit: 1000, offset };
        if (sort.column) exportOptions.sortColumn = sort.column;
        if (sort.direction) exportOptions.sortDirection = sort.direction;

        const response = await api.admin.postgres.getRows(
          schema,
          tableName,
          exportOptions
        );

        allRows.push(...response.rows);

        // Prevent infinite loop if API returns empty array despite hasMore being true
        if (response.rows.length === 0) {
          break;
        }

        offset += response.rows.length;
        hasMoreData = offset < response.totalCount;
      }

      const headers = columns.map((col) => col.name);
      const csvRows = allRows.map((row) =>
        columns.map((col) => {
          const value = row[col.name];
          if (value === null || value === undefined) return '';
          if (typeof value === 'object') return JSON.stringify(value);
          return String(value);
        })
      );

      const csvContent = createCsv(headers, csvRows);
      downloadFile(csvContent, `${schema}.${tableName}.csv`, 'text/csv');
    } catch (err) {
      console.error('Failed to export CSV:', err);
      setError(err instanceof Error ? err.message : 'Failed to export CSV');
    } finally {
      setExporting(false);
    }
  }, [schema, tableName, columns, sort.column, sort.direction, exporting]);

  // Calculate visible range
  const visibleRowItems = virtualItems.filter(
    (item) => item.index < rows.length
  );
  const firstVisible =
    visibleRowItems.length > 0 ? (visibleRowItems[0]?.index ?? null) : null;
  const lastVisible =
    visibleRowItems.length > 0
      ? (visibleRowItems[visibleRowItems.length - 1]?.index ?? null)
      : null;

  if (!schema || !tableName) {
    return (
      <div className={containerClassName}>
        {backLink}
        <p className="text-muted-foreground">No table selected.</p>
      </div>
    );
  }

  return (
    <div className={containerClassName}>
      {backLink}

      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-xl">{`${schema}.${tableName}`}</h2>
          <p className="text-muted-foreground text-sm">Table browser</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleExportCsv}
            disabled={exporting || loading || rows.length === 0}
            title="Export as CSV"
          >
            {exporting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
          </Button>
          <Button
            variant={documentView ? 'secondary' : 'ghost'}
            size="sm"
            onClick={handleToggleView}
            title={documentView ? 'Table view' : 'Document view'}
          >
            <Braces className="h-4 w-4" />
          </Button>
          <div className="relative" ref={settingsRef}>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowColumnSettings(!showColumnSettings)}
              title="Column settings"
            >
              <Settings className="h-4 w-4" />
            </Button>
            {showColumnSettings && (
              <div className="absolute right-0 z-10 mt-1 w-48 rounded-md border bg-popover p-2 shadow-lg">
                <p className="mb-2 font-medium text-sm">Visible columns</p>
                <div className="space-y-1">
                  {columns.map((col) => (
                    <label
                      key={col.name}
                      className="flex cursor-pointer items-center gap-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={!hiddenColumns.has(col.name)}
                        onChange={() => handleToggleColumn(col.name)}
                        className="h-4 w-4"
                      />
                      <span className="truncate">{col.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
          <RefreshButton
            onClick={() => fetchTableData(true)}
            loading={loading}
          />
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive">
          {error}
        </div>
      )}

      {loading && rows.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border p-8 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Loading table data...
        </div>
      ) : rows.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border p-8 text-muted-foreground">
          No rows found.
        </div>
      ) : documentView ? (
        // Document view - scroll container with sticky VirtualListStatus inside
        <div
          ref={parentRef}
          className="min-h-0 flex-1 overflow-auto rounded-lg border"
          data-testid="scroll-container"
        >
          <StickyVirtualListStatus
            firstVisible={firstVisible}
            lastVisible={lastVisible}
          />
          <div
            style={{ height: `${virtualizer.getTotalSize()}px` }}
            className="relative w-full"
          >
            {virtualItems.map((virtualItem) => {
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
      ) : (
        // Table view - scroll container with sticky VirtualListStatus inside
        <div
          ref={parentRef}
          className="min-h-0 flex-1 overflow-auto rounded-lg border"
          data-testid="scroll-container"
        >
          <StickyVirtualListStatus
            firstVisible={firstVisible}
            lastVisible={lastVisible}
          />
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
      )}
    </div>
  );
}

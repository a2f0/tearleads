import { useVirtualizer } from '@tanstack/react-virtual';
import { isRecord } from '@tearleads/shared';
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode
} from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type ColumnInfo,
  exportTableAsCsv,
  getNumberField,
  getStringField,
  parseColumnInfo
} from '@/components/sqlite/exportTableCsv';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { TableRowsDocumentView } from '@/components/sqlite/table-rows-view/TableRowsDocumentView';
import { TableRowsTableView } from '@/components/sqlite/table-rows-view/TableRowsTableView';
import { TableRowsToolbar } from '@/components/sqlite/table-rows-view/TableRowsToolbar';
import { getVirtualListStatusText } from '@/components/ui/VirtualListStatus';
import { getDatabaseAdapter } from '@/db';
import { useDatabaseContext } from '@/db/hooks';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 50;
const ROW_HEIGHT_ESTIMATE = 40;
const MIN_COLUMN_WIDTH = 50;
const KEYBOARD_RESIZE_STEP = 10;
const CONFIRM_TRUNCATE_TIMEOUT_MS = 3000;
const MOBILE_BREAKPOINT = 640; // Tailwind's sm breakpoint
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

interface TableRowsViewProps {
  tableName: string | null;
  backLink?: ReactNode;
  containerClassName?: string;
  showInlineStatus?: boolean;
  onStatusTextChange?: (text: string) => void;
  onExportCsvChange?: (
    handler: (() => Promise<void>) | null,
    exporting: boolean
  ) => void;
}

function formatCellValue(value: unknown): string {
  if (value === null) return 'NULL';
  if (value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function getRowKey(
  row: Record<string, unknown>,
  columns: ColumnInfo[],
  index: number
): string {
  const pkColumns = columns.filter((col) => col.pk > 0);
  if (pkColumns.length > 0) {
    // Prefix with 'pk-' to distinguish from index-based keys
    return `pk-${pkColumns.map((col) => String(row[col.name])).join('-')}`;
  }
  // Prefix with 'idx-' to distinguish from pk-based keys
  return `idx-${index}`;
}

export function TableRowsView({
  tableName,
  backLink,
  containerClassName = DEFAULT_CONTAINER_CLASSNAME,
  showInlineStatus = true,
  onStatusTextChange,
  onExportCsvChange
}: TableRowsViewProps) {
  const { isUnlocked, isLoading, currentInstanceId } = useDatabaseContext();

  // Track the instance ID for which we've fetched data
  const fetchedForInstanceRef = useRef<string | null>(null);
  const [columns, setColumns] = useState<ColumnInfo[]>([]);
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
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [resizing, setResizing] = useState<{
    column: string;
    startX: number;
    startWidth: number;
  } | null>(null);
  const [confirmTruncate, setConfirmTruncate] = useState(false);
  const [truncating, setTruncating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const truncateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track total count for pagination (ref to avoid fetchData dependency)
  const totalCountRef = useRef<number | null>(null);

  // Track if initial load is complete (to prevent load more during first render)
  const [initialLoadComplete, setInitialLoadComplete] = useState(false);

  // Ref-based guard to prevent concurrent load-more calls (state updates are async)
  const isLoadingMoreRef = useRef(false);

  // Track if user has scrolled (to prevent auto-loading all data on large screens)
  const [hasScrolled, setHasScrolled] = useState(false);

  const fetchTableData = useCallback(
    async (reset = true) => {
      if (!isUnlocked || !tableName) return;

      setError(null);
      if (reset) {
        setLoading(true);
        setRows([]);
        offsetRef.current = 0;
        setInitialLoadComplete(false);
        isLoadingMoreRef.current = false;
        setHasScrolled(false);
      } else {
        // Use ref guard to prevent concurrent load-more calls
        if (isLoadingMoreRef.current) return;
        isLoadingMoreRef.current = true;
        setLoadingMore(true);
      }

      try {
        const adapter = getDatabaseAdapter();

        // Validate tableName against actual tables to prevent SQL injection
        const tablesResult = await adapter.execute(
          `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`,
          []
        );
        const tableRows = Array.isArray(tablesResult.rows)
          ? tablesResult.rows
          : [];
        const validTables = tableRows
          .filter(isRecord)
          .map((row) => getStringField(row, 'name'))
          .filter((name): name is string => Boolean(name));

        if (!validTables.includes(tableName)) {
          throw new Error(`Table "${tableName}" does not exist.`);
        }

        // Get column info using PRAGMA (only on initial load when columns aren't loaded)
        let currentColumns = columns;
        if (reset && columns.length === 0) {
          const schemaResult = await adapter.execute(
            `PRAGMA table_info("${tableName}")`,
            []
          );

          const schemaRows = Array.isArray(schemaResult.rows)
            ? schemaResult.rows
            : [];
          const columnInfo = parseColumnInfo(schemaRows);

          setColumns(columnInfo);
          currentColumns = columnInfo;
        }

        // Validate sort column if set
        const validColumns = currentColumns.map((c) => c.name);
        const sortColumn =
          sort.column && validColumns.includes(sort.column)
            ? sort.column
            : null;

        // Fetch rows with pagination
        const offset = reset ? 0 : offsetRef.current;
        let query = `SELECT * FROM "${tableName}"`;
        if (sortColumn && sort.direction) {
          const direction = sort.direction === 'desc' ? 'DESC' : 'ASC';
          query += ` ORDER BY "${sortColumn}" ${direction}`;
        }
        query += ` LIMIT ${PAGE_SIZE} OFFSET ${offset}`;

        // Fetch rows and count in parallel (count only on reset)
        const [rowsResult, countResult] = await Promise.all([
          adapter.execute(query, []),
          reset
            ? adapter.execute(
                `SELECT COUNT(*) as count FROM "${tableName}"`,
                []
              )
            : Promise.resolve(null)
        ]);

        const rawRows = Array.isArray(rowsResult.rows) ? rowsResult.rows : [];
        const newRows = rawRows.filter(isRecord);

        // Update total count on reset
        if (countResult) {
          const firstRow = Array.isArray(countResult.rows)
            ? countResult.rows[0]
            : undefined;
          if (isRecord(firstRow)) {
            const count = getNumberField(firstRow, 'count');
            setTotalCount(count);
            totalCountRef.current = count;
          } else {
            // If count query was run but returned no rows/count, reset the total.
            setTotalCount(null);
            totalCountRef.current = null;
          }
        }

        if (reset) {
          setRows(newRows);
        } else {
          setRows((prev) => [...prev, ...newRows]);
        }

        const newOffset = offset + newRows.length;
        offsetRef.current = newOffset;

        // Use total count for accurate hasMore calculation
        const currentTotal = totalCountRef.current;
        setHasMore(
          currentTotal !== null
            ? newOffset < currentTotal
            : newRows.length === PAGE_SIZE
        );
      } catch (err) {
        console.error('Failed to fetch table data:', err);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (reset) {
          // Mark initial load complete after a brief delay to allow React to settle
          // This prevents the load more effect from triggering immediately
          requestAnimationFrame(() => {
            setInitialLoadComplete(true);
          });
        } else {
          isLoadingMoreRef.current = false;
        }
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [isUnlocked, tableName, sort, columns]
  );

  const handleSort = useCallback((columnName: string) => {
    setSort((prev) => {
      if (prev.column !== columnName) {
        return { column: columnName, direction: 'asc' };
      }
      if (prev.direction === 'asc') {
        return { column: columnName, direction: 'desc' };
      }
      return { column: null, direction: null };
    });
  }, []);

  const handleToggleDocumentView = useCallback(() => {
    userToggledViewRef.current = true;
    setDocumentView((prev) => !prev);
  }, []);

  const handleTruncateClick = useCallback(async () => {
    if (!confirmTruncate) {
      setConfirmTruncate(true);
      // Auto-reset if not confirmed
      truncateTimeoutRef.current = setTimeout(() => {
        setConfirmTruncate(false);
      }, CONFIRM_TRUNCATE_TIMEOUT_MS);
      return;
    }

    // Clear timeout if confirming
    if (truncateTimeoutRef.current) {
      clearTimeout(truncateTimeoutRef.current);
      truncateTimeoutRef.current = null;
    }

    if (!tableName) return;

    setTruncating(true);
    setError(null);

    try {
      const adapter = getDatabaseAdapter();
      await adapter.execute(`DELETE FROM "${tableName}"`, []);
      // Also reset the autoincrement counter to fully emulate TRUNCATE.
      // sqlite_sequence only exists if any table uses AUTOINCREMENT.
      try {
        await adapter.execute(`DELETE FROM sqlite_sequence WHERE name = ?`, [
          tableName
        ]);
      } catch (err) {
        // Only ignore the error if it's the specific "no such table" error.
        // Re-throwing other errors allows them to be caught by the outer handler.
        if (!(err instanceof Error && err.message.includes('no such table'))) {
          throw err;
        }
      }
      setConfirmTruncate(false);
      await fetchTableData();
    } catch (err) {
      console.error('Failed to truncate table:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTruncating(false);
    }
  }, [confirmTruncate, tableName, fetchTableData]);

  const exportCsv = useCallback(async () => {
    if (exporting || !isUnlocked || !tableName) return;

    setExporting(true);
    setError(null);

    try {
      await exportTableAsCsv({
        tableName,
        columns,
        sortColumn: sort.column,
        sortDirection: sort.direction,
        onColumnsResolved: (resolved) => setColumns(resolved)
      });
    } catch (err) {
      console.error('Failed to export table as CSV:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  }, [exporting, isUnlocked, tableName, columns, sort]);

  // Clear truncate timeout on unmount
  useEffect(() => {
    return () => {
      if (truncateTimeoutRef.current) {
        clearTimeout(truncateTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!onExportCsvChange) return;
    if (!isUnlocked || !tableName) {
      onExportCsvChange(null, false);
      return;
    }

    onExportCsvChange(exportCsv, exporting);
    return () => {
      onExportCsvChange(null, false);
    };
  }, [exportCsv, exporting, isUnlocked, onExportCsvChange, tableName]);

  // Update document view on window resize (only if user hasn't manually toggled)
  useEffect(() => {
    const handleResize = () => {
      if (!userToggledViewRef.current) {
        setDocumentView(isMobileViewport());
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const toggleColumnVisibility = useCallback((columnName: string) => {
    setHiddenColumns((prev) => {
      const next = new Set(prev);
      if (next.has(columnName)) {
        next.delete(columnName);
      } else {
        next.add(columnName);
      }
      return next;
    });
  }, []);

  const handleResizeStart = useCallback(
    (column: string, e: ReactMouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      const thElement = e.currentTarget.parentElement;
      if (!thElement) return;
      const startWidth = thElement.getBoundingClientRect().width;
      setResizing({ column, startX: e.clientX, startWidth });
    },
    []
  );

  const handleKeyboardResize = useCallback(
    (column: string, e: ReactKeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const delta =
          e.key === 'ArrowRight' ? KEYBOARD_RESIZE_STEP : -KEYBOARD_RESIZE_STEP;
        setColumnWidths((prev) => {
          const currentWidth = prev[column] || 150;
          return {
            ...prev,
            [column]: Math.max(MIN_COLUMN_WIDTH, currentWidth + delta)
          };
        });
      }
    },
    []
  );

  // Handle resize mouse move and mouse up at document level
  useEffect(() => {
    if (!resizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - resizing.startX;
      const newWidth = Math.max(MIN_COLUMN_WIDTH, resizing.startWidth + delta);
      setColumnWidths((prev) => ({
        ...prev,
        [resizing.column]: newWidth
      }));
    };

    const handleMouseUp = () => {
      setResizing(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizing]);

  // Get visible columns
  const visibleColumns = useMemo(
    () => columns.filter((col) => !hiddenColumns.has(col.name)),
    [columns, hiddenColumns]
  );

  // Setup virtualizer for infinite scroll
  const virtualizer = useVirtualizer({
    count: rows.length + (hasMore ? 1 : 0),
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT_ESTIMATE,
    overscan: 5
  });

  const virtualItems = virtualizer.getVirtualItems();

  // Calculate visible range (excluding loader row)
  const visibleRowItems = virtualItems.filter(
    (item) => item.index < rows.length
  );
  const firstVisible =
    visibleRowItems.length > 0 ? (visibleRowItems[0]?.index ?? null) : null;
  const lastVisible =
    visibleRowItems.length > 0
      ? (visibleRowItems[visibleRowItems.length - 1]?.index ?? null)
      : null;

  useEffect(() => {
    if (!onStatusTextChange) return;

    if (!tableName) {
      onStatusTextChange('Select a table to view its data.');
      return;
    }

    if (isLoading) {
      onStatusTextChange('Loading database...');
      return;
    }

    if (!isUnlocked) {
      onStatusTextChange('Database locked');
      return;
    }

    if (error) {
      onStatusTextChange(error);
      return;
    }

    if (loading && columns.length === 0) {
      onStatusTextChange('Loading table data...');
      return;
    }

    if (columns.length === 0) {
      onStatusTextChange('Table not found or has no columns');
      return;
    }

    onStatusTextChange(
      getVirtualListStatusText({
        firstVisible,
        lastVisible,
        loadedCount: rows.length,
        totalCount,
        hasMore,
        itemLabel: 'row'
      })
    );
  }, [
    columns.length,
    error,
    firstVisible,
    hasMore,
    isLoading,
    isUnlocked,
    lastVisible,
    loading,
    onStatusTextChange,
    rows.length,
    tableName,
    totalCount
  ]);

  // Store fetchTableData in a ref to avoid re-triggering load more effect
  const fetchTableDataRef = useRef(fetchTableData);
  fetchTableDataRef.current = fetchTableData;

  // Track scroll events to enable load-more (prevents auto-loading all data on large screens)
  // Re-run when columns load or view changes (scroll container element may change)
  // biome-ignore lint/correctness/useExhaustiveDependencies: documentView triggers re-run when scroll container changes
  useEffect(() => {
    const scrollElement = parentRef.current;
    if (!scrollElement) return;

    const handleScroll = () => {
      setHasScrolled(true);
    };

    scrollElement.addEventListener('scroll', handleScroll, {
      once: true,
      passive: true
    });
    return () => scrollElement.removeEventListener('scroll', handleScroll);
  }, [columns.length, documentView]);

  // Load more when scrolling near the end
  useEffect(() => {
    // Don't load more until initial load is complete
    if (!initialLoadComplete) return;
    // Require user to have scrolled (prevents auto-loading all data on large screens)
    if (!hasScrolled) return;
    if (!hasMore || loadingMore || loading || virtualItems.length === 0) return;

    const lastItem = virtualItems[virtualItems.length - 1];
    if (lastItem && lastItem.index >= rows.length - 5) {
      fetchTableDataRef.current(false);
    }
  }, [
    initialLoadComplete,
    hasScrolled,
    virtualItems,
    hasMore,
    loadingMore,
    loading,
    rows.length
  ]);

  // Reset sort if the sorted column is hidden
  useEffect(() => {
    if (sort.column && hiddenColumns.has(sort.column)) {
      setSort({ column: null, direction: null });
    }
  }, [hiddenColumns, sort.column]);

  // Reset sort state when table name changes
  useEffect(() => {
    if (tableName) {
      setSort({ column: null, direction: null });
    }
  }, [tableName]);

  // Track previous sort to detect changes
  const prevSortRef = useRef<SortState>({ column: null, direction: null });

  // Refetch when sort changes
  useEffect(() => {
    const sortChanged =
      prevSortRef.current.column !== sort.column ||
      prevSortRef.current.direction !== sort.direction;

    prevSortRef.current = sort;

    // Only refetch if sort actually changed and we have data
    if (sortChanged && columns.length > 0 && isUnlocked && !loading) {
      fetchTableDataRef.current();
    }
  }, [sort, columns.length, isUnlocked, loading]);

  // Fetch data on initial load, when the table changes, or when instance changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: loading, rows, and columns intentionally omitted to prevent re-fetch loops
  useEffect(() => {
    if (!isUnlocked || loading || !tableName) return;

    // Check if we need to reset for instance change
    const instanceChanged =
      fetchedForInstanceRef.current !== currentInstanceId &&
      fetchedForInstanceRef.current !== null;

    if (instanceChanged) {
      // Instance changed - clear data
      setRows([]);
      setColumns([]);
      setError(null);
      fetchedForInstanceRef.current = currentInstanceId;

      // Defer fetch to next tick to ensure database singleton is updated
      const timeoutId = setTimeout(() => {
        fetchTableDataRef.current();
      }, 0);

      return () => clearTimeout(timeoutId);
    }

    // Skip fetch if already loaded for this instance (prevents re-fetch on unrelated re-renders)
    if (
      fetchedForInstanceRef.current === currentInstanceId &&
      columns.length > 0
    ) {
      return;
    }

    // Update ref before fetching (initial load)
    fetchedForInstanceRef.current = currentInstanceId;

    // Defer fetch to next tick to ensure database singleton is updated
    const timeoutId = setTimeout(() => {
      fetchTableDataRef.current();
    }, 0);

    return () => clearTimeout(timeoutId);
  }, [isUnlocked, currentInstanceId, columns.length, tableName]);

  return (
    <div className={cn(containerClassName)}>
      <TableRowsToolbar
        backLink={backLink}
        tableName={tableName}
        isUnlocked={isUnlocked}
        columns={columns}
        hiddenColumns={hiddenColumns}
        onToggleColumn={toggleColumnVisibility}
        documentView={documentView}
        onToggleDocumentView={handleToggleDocumentView}
        confirmTruncate={confirmTruncate}
        onTruncateClick={handleTruncateClick}
        truncating={truncating}
        loading={loading}
        onRefresh={fetchTableData}
      />

      {!tableName && (
        <div className="rounded-lg border p-8 text-center text-muted-foreground">
          Select a table to view its data.
        </div>
      )}

      {isLoading && (
        <div className="rounded-lg border p-8 text-center text-muted-foreground">
          Loading database...
        </div>
      )}

      {!isLoading && !isUnlocked && <InlineUnlock description="table data" />}

      {error && (
        <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive">
          {error}
        </div>
      )}

      {isUnlocked && tableName && !error && loading && columns.length === 0 && (
        <div className="rounded-lg border p-8 text-center text-muted-foreground">
          Loading table data...
        </div>
      )}

      {isUnlocked &&
        tableName &&
        !error &&
        !loading &&
        columns.length === 0 && (
          <div className="rounded-lg border p-8 text-center text-muted-foreground">
            Table not found or has no columns
          </div>
        )}

      {isUnlocked && tableName && !error && columns.length > 0 && (
        <div className="flex min-h-0 flex-1 flex-col">
          {documentView ? (
            <TableRowsDocumentView
              parentRef={parentRef}
              showInlineStatus={showInlineStatus}
              firstVisible={firstVisible}
              lastVisible={lastVisible}
              rows={rows}
              totalCount={totalCount}
              hasMore={hasMore}
              loading={loading}
              totalSize={virtualizer.getTotalSize()}
              virtualItems={virtualItems}
              measureElement={(element) => virtualizer.measureElement(element)}
              getRowKey={(row, index) => getRowKey(row, columns, index)}
              loadingMore={loadingMore}
            />
          ) : (
            <TableRowsTableView
              parentRef={parentRef}
              showInlineStatus={showInlineStatus}
              firstVisible={firstVisible}
              lastVisible={lastVisible}
              rows={rows}
              totalCount={totalCount}
              hasMore={hasMore}
              loading={loading}
              totalSize={virtualizer.getTotalSize()}
              virtualItems={virtualItems}
              measureElement={(element) => virtualizer.measureElement(element)}
              visibleColumns={visibleColumns}
              columnWidths={columnWidths}
              sortColumn={sort.column}
              sortDirection={sort.direction}
              onSort={handleSort}
              resizingColumn={resizing?.column ?? null}
              onResizeStart={handleResizeStart}
              onKeyboardResize={handleKeyboardResize}
              getRowKey={(row, index) => getRowKey(row, columns, index)}
              formatCellValue={formatCellValue}
              loadingMore={loadingMore}
            />
          )}
        </div>
      )}
    </div>
  );
}

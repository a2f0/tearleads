import { isRecord } from '@rapid/shared';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Braces,
  Loader2,
  Settings,
  Trash2
} from 'lucide-react';
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode
} from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { Button } from '@/components/ui/button';
import { RefreshButton } from '@/components/ui/refresh-button';
import { VirtualListStatus } from '@/components/ui/VirtualListStatus';
import { getDatabaseAdapter } from '@/db';
import { useDatabaseContext } from '@/db/hooks';
import { createCsv } from '@/lib/csv';
import { downloadFile } from '@/lib/file-utils';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 50;
const ROW_HEIGHT_ESTIMATE = 40;
const MIN_COLUMN_WIDTH = 50;
const KEYBOARD_RESIZE_STEP = 10;
const CONFIRM_TRUNCATE_TIMEOUT_MS = 3000;
const MOBILE_BREAKPOINT = 640; // Tailwind's sm breakpoint
const DEFAULT_CONTAINER_CLASSNAME =
  'flex max-h-[calc(100vh-200px)] flex-col space-y-4 overflow-hidden';

function isMobileViewport(): boolean {
  return typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT;
}

interface ColumnInfo {
  name: string;
  type: string;
  pk: number;
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
  onExportCsvChange?: (
    handler: (() => Promise<void>) | null,
    exporting: boolean
  ) => void;
}

function getStringField(
  record: Record<string, unknown>,
  key: string
): string | null {
  const value = record[key];
  return typeof value === 'string' ? value : null;
}

function getNumberField(
  record: Record<string, unknown>,
  key: string
): number | null {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
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
  const [showColumnSettings, setShowColumnSettings] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);
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
          const columnInfo = schemaRows
            .filter(isRecord)
            .map((row) => {
              const name = getStringField(row, 'name');
              const type = getStringField(row, 'type');
              const pk = getNumberField(row, 'pk');
              if (!name || !type || pk === null) {
                return null;
              }
              return { name, type, pk };
            })
            .filter((col): col is ColumnInfo => col !== null);

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

      let exportColumns = columns;
      if (exportColumns.length === 0) {
        const schemaResult = await adapter.execute(
          `PRAGMA table_info("${tableName}")`,
          []
        );
        const schemaRows = Array.isArray(schemaResult.rows)
          ? schemaResult.rows
          : [];
        const columnInfo = schemaRows
          .filter(isRecord)
          .map((row) => {
            const name = getStringField(row, 'name');
            const type = getStringField(row, 'type');
            const pk = getNumberField(row, 'pk');
            if (!name || !type || pk === null) {
              return null;
            }
            return { name, type, pk };
          })
          .filter((col): col is ColumnInfo => col !== null);
        exportColumns = columnInfo;
        if (columnInfo.length > 0) {
          setColumns(columnInfo);
        }
      }

      if (exportColumns.length === 0) {
        throw new Error(`Table "${tableName}" has no columns to export.`);
      }

      const validColumns = exportColumns.map((col) => col.name);
      const sortColumn =
        sort.column && validColumns.includes(sort.column) ? sort.column : null;

      let query = `SELECT * FROM "${tableName}"`;
      if (sortColumn && sort.direction) {
        const direction = sort.direction === 'desc' ? 'DESC' : 'ASC';
        query += ` ORDER BY "${sortColumn}" ${direction}`;
      }

      const rowsResult = await adapter.execute(query, []);
      const rawRows = Array.isArray(rowsResult.rows) ? rowsResult.rows : [];
      const rowRecords = rawRows.filter(isRecord);
      const headers = exportColumns.map((col) => col.name);
      const csvRows = rowRecords.map((row) =>
        exportColumns.map((col) => row[col.name])
      );
      const csv = createCsv(headers, csvRows);
      const safeName = tableName.replace(/[<>:"/\\|?*]/g, '').trim() || 'table';
      const data = new TextEncoder().encode(csv);
      downloadFile(data, `${safeName}.csv`);
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

  // Close settings dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target;
      if (
        settingsRef.current &&
        target instanceof Node &&
        !settingsRef.current.contains(target)
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          {backLink}
          <h1 className="font-bold font-mono text-2xl tracking-tight">
            {tableName ?? 'Table'}
          </h1>
        </div>
        {isUnlocked && tableName && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative" ref={settingsRef}>
              <Button
                variant={showColumnSettings ? 'default' : 'outline'}
                size="icon"
                onClick={() => setShowColumnSettings(!showColumnSettings)}
                title="Column settings"
                data-testid="column-settings-button"
              >
                <Settings className="h-4 w-4" />
              </Button>
              {showColumnSettings && columns.length > 0 && (
                <div className="absolute top-full right-0 z-10 mt-2 w-56 rounded-lg border bg-popover p-2 shadow-lg">
                  <div className="mb-2 px-2 font-medium text-sm">
                    Visible Columns
                  </div>
                  <div className="max-h-64 overflow-y-auto">
                    {columns.map((col) => (
                      <label
                        key={col.name}
                        className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-muted"
                      >
                        <input
                          type="checkbox"
                          checked={!hiddenColumns.has(col.name)}
                          onChange={() => toggleColumnVisibility(col.name)}
                          className="h-5 w-5 rounded border-input"
                          data-testid={`column-toggle-${col.name}`}
                        />
                        <span className="font-mono text-base">{col.name}</span>
                        {col.pk > 0 && (
                          <span className="ml-auto text-primary text-xs">
                            PK
                          </span>
                        )}
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <Button
              variant={documentView ? 'default' : 'outline'}
              size="icon"
              onClick={() => {
                userToggledViewRef.current = true;
                setDocumentView(!documentView);
              }}
              title="Toggle document view"
            >
              <Braces className="h-4 w-4" />
            </Button>
            <Button
              variant={confirmTruncate ? 'destructive' : 'outline'}
              size="sm"
              onClick={handleTruncateClick}
              disabled={truncating || loading}
              title={
                confirmTruncate ? 'Click again to confirm' : 'Truncate table'
              }
              data-testid="truncate-button"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              {truncating
                ? 'Truncating...'
                : confirmTruncate
                  ? 'Confirm'
                  : 'Truncate'}
            </Button>
            <RefreshButton onClick={fetchTableData} loading={loading} />
          </div>
        )}
      </div>

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
        <div className="flex min-h-0 flex-1 flex-col space-y-4">
          <VirtualListStatus
            firstVisible={firstVisible}
            lastVisible={lastVisible}
            loadedCount={rows.length}
            totalCount={totalCount}
            hasMore={hasMore}
            itemLabel="row"
          />

          {documentView ? (
            <div className="flex min-h-0 flex-1 flex-col rounded-lg border">
              {rows.length === 0 && !loading ? (
                <div className="p-8 text-center text-muted-foreground">
                  No rows in this table
                </div>
              ) : (
                <div
                  ref={parentRef}
                  className="h-full overflow-auto p-2"
                  data-testid="scroll-container"
                >
                  <div
                    className="relative w-full"
                    style={{ height: `${virtualizer.getTotalSize()}px` }}
                  >
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
                          key={getRowKey(row, columns, virtualItem.index)}
                          data-index={virtualItem.index}
                          ref={virtualizer.measureElement}
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
                </div>
              )}
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border">
              {/* Header row - sticky */}
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
                      onClick={() => handleSort(col.name)}
                      className="inline-flex items-center gap-1 hover:text-foreground"
                      data-testid={`sort-${col.name}`}
                    >
                      {col.name}
                      {col.pk > 0 && <span className="text-primary">PK</span>}
                      {sort.column === col.name ? (
                        sort.direction === 'asc' ? (
                          <ArrowUp className="h-3 w-3" />
                        ) : (
                          <ArrowDown className="h-3 w-3" />
                        )
                      ) : (
                        <ArrowUpDown className="h-3 w-3 opacity-50" />
                      )}
                    </button>
                    {/* Resize handle */}
                    {/* biome-ignore lint/a11y/useSemanticElements: vertical separator for column resize, hr is not appropriate */}
                    <div
                      role="separator"
                      aria-orientation="vertical"
                      aria-valuenow={columnWidths[col.name] || 150}
                      aria-label={`Resize ${col.name} column`}
                      tabIndex={0}
                      className={cn(
                        'absolute top-0 right-0 h-full w-1 cursor-col-resize bg-border opacity-0 transition-opacity hover:opacity-100 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-primary group-hover:opacity-50',
                        resizing?.column === col.name && 'opacity-100'
                      )}
                      onMouseDown={(e) => handleResizeStart(col.name, e)}
                      onKeyDown={(e) => handleKeyboardResize(col.name, e)}
                    />
                  </div>
                ))}
              </div>

              {/* Virtual scroll container */}
              {rows.length === 0 && !loading ? (
                <div className="px-4 py-8 text-center text-muted-foreground">
                  No rows in this table
                </div>
              ) : (
                <div
                  ref={parentRef}
                  className="h-full overflow-auto"
                  data-testid="scroll-container"
                >
                  <div
                    className="relative w-full"
                    style={{ height: `${virtualizer.getTotalSize()}px` }}
                  >
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
                          key={getRowKey(row, columns, virtualItem.index)}
                          data-index={virtualItem.index}
                          ref={virtualizer.measureElement}
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
                                row[col.name] === null &&
                                  'text-muted-foreground italic'
                              )}
                            >
                              {formatCellValue(row[col.name])}
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

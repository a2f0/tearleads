import { isRecord } from '@tearleads/shared';
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent
} from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  exportTableAsCsv,
  getNumberField,
  getStringField,
  parseColumnInfo,
  type ColumnInfo
} from '@/components/sqlite/exportTableCsv';
import { getDatabaseAdapter } from '@/db';
import type {
  SortState,
  UseTableRowsControllerArgs,
  UseTableRowsControllerResult
} from './useTableRowsTypes';
import { useTableRowsViewport } from './useTableRowsViewport';

const PAGE_SIZE = 50;
const MIN_COLUMN_WIDTH = 50;
const KEYBOARD_RESIZE_STEP = 10;
const CONFIRM_TRUNCATE_TIMEOUT_MS = 3000;
const MOBILE_BREAKPOINT = 640;

function isMobileViewport(): boolean {
  return typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT;
}

export function useTableRowsController({
  tableName,
  isUnlocked,
  isLoading,
  currentInstanceId,
  onStatusTextChange,
  onExportCsvChange
}: UseTableRowsControllerArgs): UseTableRowsControllerResult {
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
  const [sort, setSort] = useState<SortState>({ column: null, direction: null });
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

  const totalCountRef = useRef<number | null>(null);
  const [initialLoadComplete, setInitialLoadComplete] = useState(false);
  const isLoadingMoreRef = useRef(false);

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
      } else {
        if (isLoadingMoreRef.current) return;
        isLoadingMoreRef.current = true;
        setLoadingMore(true);
      }

      try {
        const adapter = getDatabaseAdapter();

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

        const validColumns = currentColumns.map((c) => c.name);
        const sortColumn =
          sort.column && validColumns.includes(sort.column) ? sort.column : null;

        const offset = reset ? 0 : offsetRef.current;
        let query = `SELECT * FROM "${tableName}"`;
        if (sortColumn && sort.direction) {
          const direction = sort.direction === 'desc' ? 'DESC' : 'ASC';
          query += ` ORDER BY "${sortColumn}" ${direction}`;
        }
        query += ` LIMIT ${PAGE_SIZE} OFFSET ${offset}`;

        const [rowsResult, countResult] = await Promise.all([
          adapter.execute(query, []),
          reset
            ? adapter.execute(`SELECT COUNT(*) as count FROM "${tableName}"`, [])
            : Promise.resolve(null)
        ]);

        const rawRows = Array.isArray(rowsResult.rows) ? rowsResult.rows : [];
        const newRows = rawRows.filter(isRecord);

        if (countResult) {
          const firstRow = Array.isArray(countResult.rows)
            ? countResult.rows[0]
            : undefined;
          if (isRecord(firstRow)) {
            const count = getNumberField(firstRow, 'count');
            setTotalCount(count);
            totalCountRef.current = count;
          } else {
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

        const currentTotal = totalCountRef.current;
        setHasMore(
          currentTotal !== null ? newOffset < currentTotal : newRows.length === PAGE_SIZE
        );
      } catch (err) {
        console.error('Failed to fetch table data:', err);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (reset) {
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
    [columns, isUnlocked, sort, tableName]
  );

  const onSort = useCallback((columnName: string) => {
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

  const onToggleDocumentView = useCallback(() => {
    userToggledViewRef.current = true;
    setDocumentView((prev) => !prev);
  }, []);

  const onTruncateClick = useCallback(async () => {
    if (!confirmTruncate) {
      setConfirmTruncate(true);
      truncateTimeoutRef.current = setTimeout(() => {
        setConfirmTruncate(false);
      }, CONFIRM_TRUNCATE_TIMEOUT_MS);
      return;
    }

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
      try {
        await adapter.execute(`DELETE FROM sqlite_sequence WHERE name = ?`, [
          tableName
        ]);
      } catch (err) {
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
  }, [confirmTruncate, fetchTableData, tableName]);

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
  }, [columns, exporting, isUnlocked, sort, tableName]);

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

  useEffect(() => {
    const handleResize = () => {
      if (!userToggledViewRef.current) {
        setDocumentView(isMobileViewport());
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const onToggleColumn = useCallback((columnName: string) => {
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

  const onResizeStart = useCallback(
    (column: string, event: ReactMouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      const thElement = event.currentTarget.parentElement;
      if (!thElement) return;
      const startWidth = thElement.getBoundingClientRect().width;
      setResizing({ column, startX: event.clientX, startWidth });
    },
    []
  );

  const onKeyboardResize = useCallback(
    (column: string, event: ReactKeyboardEvent) => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        const delta =
          event.key === 'ArrowRight' ? KEYBOARD_RESIZE_STEP : -KEYBOARD_RESIZE_STEP;
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

  useEffect(() => {
    if (!resizing) return;

    const handleMouseMove = (event: MouseEvent) => {
      const delta = event.clientX - resizing.startX;
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
  const fetchTableDataRef = useRef(fetchTableData);
  fetchTableDataRef.current = fetchTableData;

  const {
    visibleColumns,
    firstVisible,
    lastVisible,
    virtualItems,
    totalSize,
    measureElement
  } = useTableRowsViewport({
    parentRef,
    columns,
    hiddenColumns,
    rows,
    hasMore,
    totalCount,
    loading,
    loadingMore,
    tableName,
    isLoading,
    isUnlocked,
    error,
    initialLoadComplete,
    documentView,
    onStatusTextChange,
    onFetchMore: () => fetchTableDataRef.current(false)
  });

  useEffect(() => {
    if (sort.column && hiddenColumns.has(sort.column)) {
      setSort({ column: null, direction: null });
    }
  }, [hiddenColumns, sort.column]);

  useEffect(() => {
    if (tableName) {
      setSort({ column: null, direction: null });
    }
  }, [tableName]);

  const prevSortRef = useRef<SortState>({ column: null, direction: null });
  useEffect(() => {
    const sortChanged =
      prevSortRef.current.column !== sort.column ||
      prevSortRef.current.direction !== sort.direction;

    prevSortRef.current = sort;

    if (sortChanged && columns.length > 0 && isUnlocked && !loading) {
      fetchTableDataRef.current();
    }
  }, [columns.length, isUnlocked, loading, sort]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: loading intentionally omitted to prevent re-fetch loops
  useEffect(() => {
    if (!isUnlocked || loading || !tableName) return;

    const instanceChanged =
      fetchedForInstanceRef.current !== currentInstanceId &&
      fetchedForInstanceRef.current !== null;

    if (instanceChanged) {
      setRows([]);
      setColumns([]);
      setError(null);
      fetchedForInstanceRef.current = currentInstanceId;

      const timeoutId = setTimeout(() => {
        fetchTableDataRef.current();
      }, 0);

      return () => clearTimeout(timeoutId);
    }

    if (
      fetchedForInstanceRef.current === currentInstanceId &&
      columns.length > 0
    ) {
      return;
    }

    fetchedForInstanceRef.current = currentInstanceId;

    const timeoutId = setTimeout(() => {
      fetchTableDataRef.current();
    }, 0);

    return () => clearTimeout(timeoutId);
  }, [columns.length, currentInstanceId, isUnlocked, loading, tableName]);

  return {
    parentRef,
    columns,
    rows,
    loading,
    loadingMore,
    error,
    hasMore,
    totalCount,
    documentView,
    sort,
    hiddenColumns,
    visibleColumns,
    columnWidths,
    resizingColumn: resizing?.column ?? null,
    confirmTruncate,
    truncating,
    firstVisible,
    lastVisible,
    virtualItems,
    totalSize,
    measureElement,
    onSort,
    onToggleColumn,
    onToggleDocumentView,
    onTruncateClick,
    onResizeStart,
    onKeyboardResize,
    onRefresh: fetchTableData
  };
}

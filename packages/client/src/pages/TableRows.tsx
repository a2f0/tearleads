import { isRecord } from '@rapid/shared';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Braces,
  Settings,
  Trash2
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { BackLink } from '@/components/ui/back-link';
import { Button } from '@/components/ui/button';
import { RefreshButton } from '@/components/ui/refresh-button';
import { getDatabaseAdapter } from '@/db';
import { useDatabaseContext } from '@/db/hooks';
import { cn } from '@/lib/utils';

const MIN_COLUMN_WIDTH = 50;
const KEYBOARD_RESIZE_STEP = 10;
const CONFIRM_TRUNCATE_TIMEOUT_MS = 3000;
const MOBILE_BREAKPOINT = 640; // Tailwind's sm breakpoint

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
    return pkColumns.map((col) => String(row[col.name])).join('-');
  }
  return String(index);
}

export function TableRows() {
  const { tableName } = useParams<{ tableName: string }>();
  const { isUnlocked, isLoading, currentInstanceId } = useDatabaseContext();

  // Track the instance ID for which we've fetched data
  const fetchedForInstanceRef = useRef<string | null>(null);
  const [columns, setColumns] = useState<ColumnInfo[]>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
  const truncateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchTableData = useCallback(async () => {
    if (!isUnlocked || !tableName) return;

    setLoading(true);
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

      // Get column info using PRAGMA
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

      // Validate sort column if set
      const validColumns = columnInfo.map((c) => c.name);
      const sortColumn =
        sort.column && validColumns.includes(sort.column) ? sort.column : null;

      // Fetch rows (with limit for performance)
      let query = `SELECT * FROM "${tableName}"`;
      if (sortColumn && sort.direction) {
        const direction = sort.direction === 'desc' ? 'DESC' : 'ASC';
        query += ` ORDER BY "${sortColumn}" ${direction}`;
      }
      query += ' LIMIT 100';

      const rowsResult = await adapter.execute(query, []);
      const rawRows = Array.isArray(rowsResult.rows) ? rowsResult.rows : [];
      const safeRows = rawRows.filter(isRecord);
      setRows(safeRows);
    } catch (err) {
      console.error('Failed to fetch table data:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [isUnlocked, tableName, sort]);

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

  // Clear truncate timeout on unmount
  useEffect(() => {
    return () => {
      if (truncateTimeoutRef.current) {
        clearTimeout(truncateTimeoutRef.current);
      }
    };
  }, []);

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
    (column: string, e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      const thElement = e.currentTarget.parentElement;
      if (!thElement) return;
      const startWidth = thElement.getBoundingClientRect().width;
      setResizing({ column, startX: e.clientX, startWidth });
    },
    []
  );

  const handleKeyboardResize = useCallback(
    (column: string, e: React.KeyboardEvent) => {
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

  // Fetch data on initial load, when the table changes, or when instance changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: loading, rows, and columns intentionally omitted to prevent re-fetch loops
  useEffect(() => {
    if (!isUnlocked || loading) return;

    // Check if we need to reset for instance change
    if (
      fetchedForInstanceRef.current !== currentInstanceId &&
      fetchedForInstanceRef.current !== null
    ) {
      // Instance changed - clear data
      setRows([]);
      setColumns([]);
      setError(null);
    }

    // Update ref before fetching
    fetchedForInstanceRef.current = currentInstanceId;

    // Defer fetch to next tick to ensure database singleton is updated
    const timeoutId = setTimeout(() => {
      fetchTableData();
    }, 0);

    return () => clearTimeout(timeoutId);
  }, [isUnlocked, currentInstanceId, fetchTableData]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <BackLink defaultTo="/tables" defaultLabel="Back to Tables" />
          <h1 className="font-bold font-mono text-2xl tracking-tight">
            {tableName}
          </h1>
        </div>
        {isUnlocked && (
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

      {isUnlocked && !error && loading && columns.length === 0 && (
        <div className="rounded-lg border p-8 text-center text-muted-foreground">
          Loading table data...
        </div>
      )}

      {isUnlocked && !error && !loading && columns.length === 0 && (
        <div className="rounded-lg border p-8 text-center text-muted-foreground">
          Table not found or has no columns
        </div>
      )}

      {isUnlocked && !error && columns.length > 0 && (
        <div className="space-y-4">
          <p className="text-muted-foreground text-sm">
            Showing {rows.length} row{rows.length !== 1 ? 's' : ''}
            {rows.length === 100 ? ' (limited to 100)' : ''}
          </p>

          {documentView ? (
            <div className="space-y-3">
              {rows.length === 0 ? (
                <div className="rounded-lg border p-8 text-center text-muted-foreground">
                  No rows in this table
                </div>
              ) : (
                rows.map((row, index) => (
                  <pre
                    key={getRowKey(row, columns, index)}
                    className="overflow-x-auto rounded-lg border bg-muted/30 p-4 font-mono text-sm"
                  >
                    {JSON.stringify(row, null, 2)}
                  </pre>
                ))
              )}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table
                className="min-w-full divide-y divide-border"
                style={{ tableLayout: 'fixed' }}
              >
                <thead className="bg-muted/50">
                  <tr>
                    {visibleColumns.map((col) => (
                      <th
                        key={col.name}
                        className="group relative px-4 py-3 text-left font-medium text-muted-foreground text-xs uppercase tracking-wider"
                        style={{
                          width: columnWidths[col.name]
                            ? `${columnWidths[col.name]}px`
                            : 'auto'
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => handleSort(col.name)}
                          className="inline-flex items-center gap-1 hover:text-foreground"
                          data-testid={`sort-${col.name}`}
                        >
                          {col.name}
                          {col.pk > 0 && (
                            <span className="text-primary">PK</span>
                          )}
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
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border bg-background">
                  {rows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={visibleColumns.length}
                        className="px-4 py-8 text-center text-muted-foreground"
                      >
                        No rows in this table
                      </td>
                    </tr>
                  ) : (
                    rows.map((row, index) => (
                      <tr
                        key={getRowKey(row, columns, index)}
                        className="hover:bg-muted/25"
                      >
                        {visibleColumns.map((col) => (
                          <td
                            key={col.name}
                            className={`whitespace-nowrap px-4 py-2 font-mono text-sm ${
                              row[col.name] === null
                                ? 'text-muted-foreground italic'
                                : ''
                            }`}
                          >
                            {formatCellValue(row[col.name])}
                          </td>
                        ))}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

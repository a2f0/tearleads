/**
 * Table sizes component for the SQLite page.
 * Shows database and individual table sizes.
 */

import { isRecord, toFiniteNumber } from '@rapid/shared';
import { HardDrive } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { LinkWithFrom } from '@/components/ui/back-link/LinkWithFrom';
import { RefreshButton } from '@/components/ui/refresh-button';
import { getDatabaseAdapter } from '@/db';
import { useDatabaseContext } from '@/db/hooks';

interface TableSize {
  name: string;
  size: number;
  isEstimated: boolean;
  rowCount: number;
}

/** Estimated average row size in bytes when dbstat is unavailable */
const AVG_ROW_SIZE_ESTIMATE_BYTES = 100;
const ROW_COUNT_FORMATTER = new Intl.NumberFormat('en-US');

function getRowNumber(row: unknown, key: string): number | null {
  if (Array.isArray(row)) {
    return toFiniteNumber(row[0]);
  }
  if (isRecord(row)) {
    return toFiniteNumber(row[key]);
  }
  return null;
}

function getRowString(row: unknown, key: string): string | null {
  if (Array.isArray(row)) {
    const value = row[0];
    return typeof value === 'string' ? value : null;
  }
  if (isRecord(row)) {
    const value = row[key];
    return typeof value === 'string' ? value : null;
  }
  return null;
}

function formatBytesParts(bytes: number): { value: string; unit: string } {
  if (bytes <= 0) return { value: '0', unit: 'B' };
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB'];
  const i = Math.max(0, Math.floor(Math.log(bytes) / Math.log(k)));
  const unitIndex = Math.min(i, sizes.length - 1);
  const unit = sizes[unitIndex] ?? sizes[sizes.length - 1] ?? 'B';
  return {
    value: parseFloat((bytes / k ** unitIndex).toFixed(2)).toString(),
    unit
  };
}

function formatRowCount(count: number): string {
  return ROW_COUNT_FORMATTER.format(count);
}

interface TableSizesProps {
  onTableSelect?: (tableName: string) => void;
}

export function TableSizes({ onTableSelect }: TableSizesProps) {
  const { isUnlocked } = useDatabaseContext();
  const [tableSizes, setTableSizes] = useState<TableSize[]>([]);
  const [totalSize, setTotalSize] = useState<number>(0);
  const [isTotalSizeEstimated, setIsTotalSizeEstimated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSizes = useCallback(async () => {
    if (!isUnlocked) return;

    setLoading(true);
    setError(null);

    try {
      const adapter = getDatabaseAdapter();

      // Get page size and count for total database size
      const pageSizeResult = await adapter.execute('PRAGMA page_size', []);
      const pageCountResult = await adapter.execute('PRAGMA page_count', []);

      if (!pageSizeResult.rows.length || !pageCountResult.rows.length) {
        throw new Error('Failed to retrieve database page size or count.');
      }
      const pageSizeRow = pageSizeResult.rows[0];
      const pageCountRow = pageCountResult.rows[0];

      const pageSize = getRowNumber(pageSizeRow, 'page_size') ?? 0;
      const pageCount = getRowNumber(pageCountRow, 'page_count') ?? 0;
      const pragmaTotalSize = pageSize * pageCount;

      // Get all table names
      const tablesResult = await adapter.execute(
        `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
        []
      );

      const tableNames = tablesResult.rows
        .map((row) => getRowString(row, 'name'))
        .filter((name): name is string => Boolean(name));

      // Try to get individual table sizes using dbstat virtual table
      // This may not be available in all SQLite builds
      const sizes: TableSize[] = await Promise.all(
        tableNames.map(async (name) => {
          let rowCount = 0;
          try {
            const countResult = await adapter.execute(
              `SELECT COUNT(*) as count FROM "${name}"`,
              []
            );
            const countRow = countResult.rows[0];
            rowCount = getRowNumber(countRow, 'count') ?? 0;
          } catch {
            rowCount = 0;
          }
          try {
            const sizeResult = await adapter.execute(
              `SELECT SUM(pgsize) as size FROM dbstat WHERE name = ?`,
              [name]
            );
            const sizeRow = sizeResult.rows[0];
            const size = getRowNumber(sizeRow, 'size') ?? 0;
            return { name, size, isEstimated: false, rowCount };
          } catch {
            // dbstat not available, estimate using row count and average row size
            return {
              name,
              size: rowCount * AVG_ROW_SIZE_ESTIMATE_BYTES,
              isEstimated: true,
              rowCount
            };
          }
        })
      );

      // Sort by size descending
      sizes.sort((a, b) => b.size - a.size);
      setTableSizes(sizes);

      // On iOS with Capacitor SQLite (SQLCipher), PRAGMA page_count may return 0.
      // Fall back to summing table sizes when the PRAGMA-based calculation fails.
      if (pragmaTotalSize > 0) {
        setTotalSize(pragmaTotalSize);
        setIsTotalSizeEstimated(false);
      } else if (sizes.length > 0) {
        const summedSize = sizes.reduce((acc, table) => acc + table.size, 0);
        setTotalSize(summedSize);
        setIsTotalSizeEstimated(sizes.some((s) => s.isEstimated));
      } else {
        setTotalSize(0);
        setIsTotalSizeEstimated(false);
      }
    } catch (err) {
      console.error('Failed to fetch table sizes:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [isUnlocked]);

  useEffect(() => {
    if (isUnlocked && tableSizes.length === 0 && !loading && !error) {
      fetchSizes();
    }
  }, [isUnlocked, tableSizes.length, loading, error, fetchSizes]);

  // Reset when database is locked
  useEffect(() => {
    if (!isUnlocked) {
      setTableSizes([]);
      setTotalSize(0);
      setIsTotalSizeEstimated(false);
      setError(null);
    }
  }, [isUnlocked]);

  if (!isUnlocked) {
    return null;
  }

  const totalSizeParts = formatBytesParts(totalSize);

  return (
    <div className="space-y-3 rounded-lg border p-4" data-testid="table-sizes">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">Table summary</h2>
        <RefreshButton
          onClick={fetchSizes}
          loading={loading}
          variant="ghost"
          className="h-8 w-8"
        />
      </div>

      {error && <div className="text-destructive text-sm">{error}</div>}

      {!error && (
        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between border-b pb-2">
            <div className="flex items-center gap-2">
              <HardDrive className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">Total Database</span>
            </div>
            <span className="font-mono">
              {isTotalSizeEstimated ? '~' : ''}
              {totalSizeParts.value} {totalSizeParts.unit}
            </span>
          </div>

          {loading && tableSizes.length === 0 ? (
            <div className="py-2 text-center text-muted-foreground">
              Loading...
            </div>
          ) : tableSizes.length === 0 ? (
            <div className="py-2 text-center text-muted-foreground">
              No tables found
            </div>
          ) : (
            <>
              {tableSizes.some((t) => t.isEstimated) && (
                <div className="text-muted-foreground text-xs italic">
                  * Sizes are estimated (dbstat unavailable)
                </div>
              )}
              <div className="space-y-1">
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,4.5rem)_minmax(0,3rem)_minmax(0,5.5rem)] items-center gap-3 border-b pb-1 font-medium text-muted-foreground text-xs">
                  <span>Table</span>
                  <span className="col-span-2 text-right">Size</span>
                  <span className="text-right">Rows</span>
                </div>
                {tableSizes.map((table) => {
                  const tablePath = `/sqlite/tables/${encodeURIComponent(
                    table.name
                  )}`;
                  const sizeParts = formatBytesParts(table.size);

                  return (
                    <div
                      key={table.name}
                      className="grid grid-cols-[minmax(0,1fr)_minmax(0,4.5rem)_minmax(0,3rem)_minmax(0,5.5rem)] items-center gap-3"
                    >
                      {onTableSelect ? (
                        <button
                          type="button"
                          onClick={() => onTableSelect(table.name)}
                          className="truncate text-left font-mono text-muted-foreground hover:text-foreground hover:underline"
                        >
                          {table.name}
                        </button>
                      ) : (
                        <LinkWithFrom
                          to={tablePath}
                          fromLabel="Back to SQLite"
                          className="truncate font-mono text-muted-foreground hover:text-foreground hover:underline"
                        >
                          {table.name}
                        </LinkWithFrom>
                      )}
                      <span className="shrink-0 text-right font-mono text-xs">
                        {table.isEstimated ? '~' : ''}
                        {sizeParts.value}
                      </span>
                      <span className="shrink-0 text-left font-mono text-xs">
                        {sizeParts.unit}
                      </span>
                      <span className="shrink-0 text-right font-mono text-xs">
                        {formatRowCount(table.rowCount)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

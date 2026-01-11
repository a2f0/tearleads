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
}

/** Estimated average row size in bytes when dbstat is unavailable */
const AVG_ROW_SIZE_ESTIMATE_BYTES = 100;

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

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`;
}

export function TableSizes() {
  const { isUnlocked } = useDatabaseContext();
  const [tableSizes, setTableSizes] = useState<TableSize[]>([]);
  const [totalSize, setTotalSize] = useState<number>(0);
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
      setTotalSize(pageSize * pageCount);

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
          try {
            const sizeResult = await adapter.execute(
              `SELECT SUM(pgsize) as size FROM dbstat WHERE name = ?`,
              [name]
            );
            const sizeRow = sizeResult.rows[0];
            const size = getRowNumber(sizeRow, 'size') ?? 0;
            return { name, size, isEstimated: false };
          } catch {
            // dbstat not available, estimate using row count and average row size
            const countResult = await adapter.execute(
              `SELECT COUNT(*) as count FROM "${name}"`,
              []
            );
            const countRow = countResult.rows[0];
            const count = getRowNumber(countRow, 'count') ?? 0;
            return {
              name,
              size: count * AVG_ROW_SIZE_ESTIMATE_BYTES,
              isEstimated: true
            };
          }
        })
      );

      // Sort by size descending
      sizes.sort((a, b) => b.size - a.size);
      setTableSizes(sizes);

      // On iOS with Capacitor SQLite (SQLCipher), PRAGMA page_count may return 0.
      // Fall back to summing table sizes when the PRAGMA-based calculation fails.
      if (pageSize * pageCount === 0 && sizes.length > 0) {
        const summedSize = sizes.reduce((acc, table) => acc + table.size, 0);
        setTotalSize(summedSize);
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
      setError(null);
    }
  }, [isUnlocked]);

  if (!isUnlocked) {
    return null;
  }

  return (
    <div className="space-y-3 rounded-lg border p-4" data-testid="table-sizes">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">Table Sizes</h2>
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
            <span className="font-mono">{formatBytes(totalSize)}</span>
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
                {tableSizes.map((table) => (
                  <div
                    key={table.name}
                    className="flex items-center justify-between"
                  >
                    <LinkWithFrom
                      to={`/tables/${encodeURIComponent(table.name)}`}
                      fromLabel="Back to SQLite"
                      className="truncate font-mono text-muted-foreground hover:text-foreground hover:underline"
                    >
                      {table.name}
                    </LinkWithFrom>
                    <span className="shrink-0 font-mono text-xs">
                      {table.isEstimated ? '~' : ''}
                      {formatBytes(table.size)}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Table sizes component for the SQLite page.
 * Shows database and individual table sizes.
 */

import { HardDrive, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { getDatabaseAdapter } from '@/db';
import { useDatabaseContext } from '@/db/hooks';

interface TableSize {
  name: string;
  size: number;
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

      const pageSizeRow = pageSizeResult.rows[0] as Record<string, unknown>;
      const pageCountRow = pageCountResult.rows[0] as Record<string, unknown>;

      const pageSize = Number(pageSizeRow['page_size'] ?? pageSizeRow[0] ?? 0);
      const pageCount = Number(
        pageCountRow['page_count'] ?? pageCountRow[0] ?? 0
      );
      setTotalSize(pageSize * pageCount);

      // Get all table names
      const tablesResult = await adapter.execute(
        `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
        []
      );

      const tableNames = tablesResult.rows.map((row) => {
        const r = row as Record<string, unknown>;
        const name = r['name'];
        if (typeof name !== 'string') {
          throw new Error('Unexpected row format from sqlite_master');
        }
        return name;
      });

      // Try to get individual table sizes using dbstat virtual table
      // This may not be available in all SQLite builds
      const sizes: TableSize[] = [];
      for (const name of tableNames) {
        try {
          const sizeResult = await adapter.execute(
            `SELECT SUM(pgsize) as size FROM dbstat WHERE name = ?`,
            [name]
          );
          const sizeRow = sizeResult.rows[0] as Record<string, unknown>;
          const size = Number(sizeRow['size'] ?? sizeRow[0] ?? 0);
          sizes.push({ name, size });
        } catch {
          // dbstat not available, estimate using row count and average row size
          const countResult = await adapter.execute(
            `SELECT COUNT(*) as count FROM "${name}"`,
            []
          );
          const countRow = countResult.rows[0] as Record<string, unknown>;
          const count = Number(countRow['count'] ?? countRow[0] ?? 0);
          // Rough estimate: assume 100 bytes per row average
          sizes.push({ name, size: count * 100 });
        }
      }

      // Sort by size descending
      sizes.sort((a, b) => b.size - a.size);
      setTableSizes(sizes);
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
        <Button
          variant="ghost"
          size="sm"
          onClick={fetchSizes}
          disabled={loading}
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
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
            <div className="space-y-1">
              {tableSizes.map((table) => (
                <div
                  key={table.name}
                  className="flex items-center justify-between"
                >
                  <span className="truncate font-mono text-muted-foreground">
                    {table.name}
                  </span>
                  <span className="shrink-0 font-mono text-xs">
                    {formatBytes(table.size)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

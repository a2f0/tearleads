import { HardDrive } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PostgresTableInfo } from '@rapid/shared';
import { RefreshButton } from '@/components/ui/refresh-button';
import { api } from '@/lib/api';

const ROW_COUNT_FORMATTER = new Intl.NumberFormat('en-US');

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.floor(Math.log(bytes) / Math.log(k));
  const value = bytes / k ** index;
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${sizes[index]}`;
}

function formatRowCount(count: number): string {
  return ROW_COUNT_FORMATTER.format(count);
}

export function PostgresTableSizes() {
  const [tables, setTables] = useState<PostgresTableInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalBytes = useMemo(
    () => tables.reduce((sum, table) => sum + table.totalBytes, 0),
    [tables]
  );

  const fetchTables = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.admin.postgres.getTables();
      const sorted = [...response.tables].sort(
        (a, b) => b.totalBytes - a.totalBytes
      );
      setTables(sorted);
    } catch (err) {
      console.error('Failed to fetch Postgres tables:', err);
      setError(err instanceof Error ? err.message : String(err));
      setTables([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTables();
  }, [fetchTables]);

  return (
    <div className="space-y-3 rounded-lg border p-4" data-testid="postgres-table-sizes">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">Table summary</h2>
        <RefreshButton
          onClick={fetchTables}
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
            <span className="font-mono">{formatBytes(totalBytes)}</span>
          </div>

          {loading && tables.length === 0 ? (
            <div className="py-2 text-center text-muted-foreground">
              Loading...
            </div>
          ) : tables.length === 0 ? (
            <div className="py-2 text-center text-muted-foreground">
              No tables found
            </div>
          ) : (
            <div className="space-y-1">
              <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 border-b pb-1 font-medium text-muted-foreground text-xs">
                <span>Table</span>
                <span className="text-right">Size</span>
                <span className="text-right">Rows</span>
              </div>
              {tables.map((table) => {
                const label = `${table.schema}.${table.name}`;
                return (
                  <div
                    key={label}
                    className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3"
                  >
                    <span className="truncate font-mono text-muted-foreground">
                      {label}
                    </span>
                    <span className="shrink-0 text-right font-mono text-xs">
                      {formatBytes(table.totalBytes)}
                    </span>
                    <span className="shrink-0 text-right font-mono text-xs">
                      {formatRowCount(table.rowCount)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

import { Database, RefreshCw, Table2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { getDatabaseAdapter } from '@/db';
import { useDatabaseContext } from '@/db/hooks';

interface TableInfo {
  name: string;
  rowCount: number;
}

export function Tables() {
  const { isUnlocked, isLoading } = useDatabaseContext();
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTables = useCallback(async () => {
    if (!isUnlocked) return;

    setLoading(true);
    setError(null);

    try {
      const adapter = getDatabaseAdapter();

      // Get all table names
      const tablesResult = await adapter.execute(
        `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
        []
      );

      const tableNames = tablesResult.rows.map(
        (row) => (row as { name: string }).name
      );

      // Get row count for each table
      const tablesWithCounts: TableInfo[] = await Promise.all(
        tableNames.map(async (name) => {
          const countResult = await adapter.execute(
            `SELECT COUNT(*) as count FROM "${name}"`,
            []
          );
          const count = (countResult.rows[0] as { count: number }).count;
          return { name, rowCount: count };
        })
      );

      setTables(tablesWithCounts);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [isUnlocked]);

  useEffect(() => {
    if (isUnlocked && tables.length === 0 && !loading) {
      fetchTables();
    }
  }, [isUnlocked, tables.length, loading, fetchTables]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Tables</h1>
        {isUnlocked && (
          <Button
            variant="outline"
            size="sm"
            onClick={fetchTables}
            disabled={loading}
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`}
            />
            Refresh
          </Button>
        )}
      </div>

      {isLoading && (
        <div className="rounded-lg border p-8 text-center text-muted-foreground">
          Loading database...
        </div>
      )}

      {!isLoading && !isUnlocked && (
        <div className="rounded-lg border p-8 text-center">
          <Database className="mx-auto h-12 w-12 text-muted-foreground/50" />
          <p className="mt-4 text-muted-foreground">
            Database is locked. Unlock it from the Debug page to view tables.
          </p>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive">
          {error}
        </div>
      )}

      {isUnlocked && !error && (
        <div className="space-y-2">
          {loading && tables.length === 0 ? (
            <div className="rounded-lg border p-8 text-center text-muted-foreground">
              Loading tables...
            </div>
          ) : tables.length === 0 ? (
            <div className="rounded-lg border p-8 text-center text-muted-foreground">
              No tables found
            </div>
          ) : (
            tables.map((table) => (
              <div
                key={table.name}
                className="flex items-center gap-3 rounded-lg border bg-muted/50 p-3"
              >
                <Table2 className="h-5 w-5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium font-mono">
                    {table.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {table.rowCount} {table.rowCount === 1 ? 'row' : 'rows'}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

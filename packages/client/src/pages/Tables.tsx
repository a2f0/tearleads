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

      const tableNames = tablesResult.rows.map((row) => {
        const r = row as Record<string, unknown>;
        const name = r['name'];
        if (typeof name !== 'string') {
          throw new Error('Unexpected row format from sqlite_master');
        }
        return name;
      });

      // Get row count for each table
      const tablesWithCounts: TableInfo[] = await Promise.all(
        tableNames.map(async (name) => {
          const countResult = await adapter.execute(
            `SELECT COUNT(*) as count FROM "${name}"`,
            []
          );
          const countRow = countResult.rows[0] as Record<string, unknown>;
          const count = countRow['count'];
          if (typeof count !== 'number') {
            throw new Error(`Unexpected count format for table "${name}"`);
          }
          return { name, rowCount: count };
        })
      );

      setTables(tablesWithCounts);
    } catch (err) {
      console.error('Failed to fetch tables:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [isUnlocked]);

  useEffect(() => {
    if (isUnlocked && tables.length === 0 && !loading && !error) {
      fetchTables();
    }
  }, [isUnlocked, tables.length, loading, fetchTables, error]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-bold text-2xl tracking-tight">Tables</h1>
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
                  <p className="truncate font-medium font-mono text-sm">
                    {table.name}
                  </p>
                  <p className="text-muted-foreground text-xs">
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

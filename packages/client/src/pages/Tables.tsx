import { isRecord, toFiniteNumber } from '@rapid/shared';
import { ChevronRight, Table2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { BackLink, LinkWithFrom } from '@/components/ui/back-link';
import { RefreshButton } from '@/components/ui/refresh-button';
import { getDatabaseAdapter } from '@/db';
import { useDatabaseContext } from '@/db/hooks';

interface TableInfo {
  name: string;
  rowCount: number;
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

function getRowNumber(row: unknown, key: string): number | null {
  if (Array.isArray(row)) {
    return toFiniteNumber(row[0]);
  }
  if (isRecord(row)) {
    return toFiniteNumber(row[key]);
  }
  return null;
}

interface TablesProps {
  showBackLink?: boolean;
}

export function Tables({ showBackLink = true }: TablesProps) {
  const { isUnlocked, isLoading, currentInstanceId } = useDatabaseContext();
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track the instance ID for which we've fetched tables
  const fetchedForInstanceRef = useRef<string | null>(null);

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

      const tableNames = tablesResult.rows
        .map((row) => getRowString(row, 'name'))
        .filter((name): name is string => Boolean(name));

      // Get row count for each table
      const tablesWithCounts: TableInfo[] = await Promise.all(
        tableNames.map(async (name) => {
          const countResult = await adapter.execute(
            `SELECT COUNT(*) as count FROM "${name}"`,
            []
          );
          const countRow = countResult.rows[0];
          const count = getRowNumber(countRow, 'count');
          if (count === null) {
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: tables intentionally excluded to prevent re-fetch loops
  useEffect(() => {
    if (!isUnlocked) return;

    // Check if we need to fetch for this instance
    const needsFetch =
      (tables.length === 0 && !error) ||
      fetchedForInstanceRef.current !== currentInstanceId;

    if (needsFetch && !loading) {
      // If instance changed, clear tables
      if (
        fetchedForInstanceRef.current !== currentInstanceId &&
        fetchedForInstanceRef.current !== null
      ) {
        setTables([]);
        setError(null);
      }

      // Update ref before fetching
      fetchedForInstanceRef.current = currentInstanceId;

      // Defer fetch to next tick to ensure database singleton is updated
      const timeoutId = setTimeout(() => {
        fetchTables();
      }, 0);

      return () => clearTimeout(timeoutId);
    }
    return undefined;
  }, [isUnlocked, currentInstanceId, loading, fetchTables, error]);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        {showBackLink && <BackLink defaultTo="/" defaultLabel="Back to Home" />}
        <div className="flex items-center justify-between">
          <h1 className="font-bold text-2xl tracking-tight">Tables</h1>
          {isUnlocked && (
            <RefreshButton onClick={fetchTables} loading={loading} />
          )}
        </div>
      </div>

      {isLoading && (
        <div className="rounded-lg border p-8 text-center text-muted-foreground">
          Loading database...
        </div>
      )}

      {!isLoading && !isUnlocked && <InlineUnlock description="tables" />}

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
              <LinkWithFrom
                key={table.name}
                to={`/sqlite/tables/${encodeURIComponent(table.name)}`}
                fromLabel="Back to Tables"
                className="flex items-center gap-3 rounded-lg border bg-muted/50 p-3 transition-colors hover:bg-muted"
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
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </LinkWithFrom>
            ))
          )}
        </div>
      )}
    </div>
  );
}

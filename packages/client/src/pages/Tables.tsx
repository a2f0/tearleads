import { isRecord, toFiniteNumber } from '@tearleads/shared';
import { ChevronRight, Table2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { BackLink, LinkWithFrom } from '@/components/ui/back-link';
import { RefreshButton } from '@/components/ui/RefreshButton';
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

function shouldFetchTables(
  isUnlocked: boolean,
  loading: boolean,
  tables: TableInfo[],
  error: string | null,
  currentInstanceId: string | null,
  fetchedForInstanceId: string | null
) {
  if (!isUnlocked || loading) {
    return false;
  }

  const noTablesFetchedYet = tables.length === 0 && !error;
  const instanceChanged = fetchedForInstanceId !== currentInstanceId;
  return noTablesFetchedYet || instanceChanged;
}

function shouldResetTablesForInstanceChange(
  fetchedForInstanceId: string | null,
  currentInstanceId: string | null
) {
  return (
    fetchedForInstanceId !== null && fetchedForInstanceId !== currentInstanceId
  );
}

function renderTablesContent(
  isUnlocked: boolean,
  error: string | null,
  loading: boolean,
  tables: TableInfo[]
) {
  if (!isUnlocked || error) {
    return null;
  }

  if (loading && tables.length === 0) {
    return (
      <div className="rounded-lg border p-8 text-center text-muted-foreground">
        Loading tables...
      </div>
    );
  }

  if (tables.length === 0) {
    return (
      <div className="rounded-lg border p-8 text-center text-muted-foreground">
        No tables found
      </div>
    );
  }

  return tables.map((table) => (
    <LinkWithFrom
      key={table.name}
      to={`/sqlite/tables/${encodeURIComponent(table.name)}`}
      fromLabel="Back to Tables"
      className="flex items-center gap-3 rounded-lg border bg-muted/50 p-3 transition-colors hover:bg-muted"
    >
      <Table2 className="h-5 w-5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium font-mono text-sm">{table.name}</p>
        <p className="text-muted-foreground text-xs">
          {table.rowCount} {table.rowCount === 1 ? 'row' : 'rows'}
        </p>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </LinkWithFrom>
  ));
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
    if (
      !shouldFetchTables(
        isUnlocked,
        loading,
        tables,
        error,
        currentInstanceId,
        fetchedForInstanceRef.current
      )
    ) {
      return undefined;
    }

    if (
      shouldResetTablesForInstanceChange(
        fetchedForInstanceRef.current,
        currentInstanceId
      )
    ) {
      setTables([]);
      setError(null);
    }

    fetchedForInstanceRef.current = currentInstanceId;
    const timeoutId = setTimeout(() => {
      fetchTables();
    }, 0);

    return () => clearTimeout(timeoutId);
  }, [isUnlocked, currentInstanceId, loading, fetchTables, error]);

  return (
    <div className="flex h-full flex-col space-y-6 overflow-auto">
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

      <div className="space-y-2">
        {renderTablesContent(isUnlocked, error, loading, tables)}
      </div>
    </div>
  );
}

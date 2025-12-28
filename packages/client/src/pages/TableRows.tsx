import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ArrowUpDown,
  Braces,
  Database,
  RefreshCw
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { getDatabaseAdapter } from '@/db';
import { useDatabaseContext } from '@/db/hooks';

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
  const { isUnlocked, isLoading } = useDatabaseContext();
  const [columns, setColumns] = useState<ColumnInfo[]>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [documentView, setDocumentView] = useState(false);
  const [sort, setSort] = useState<SortState>({
    column: null,
    direction: null
  });

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
      const validTables = tablesResult.rows.map(
        (row) => (row as Record<string, unknown>)['name'] as string
      );

      if (!validTables.includes(tableName)) {
        throw new Error(`Table "${tableName}" does not exist.`);
      }

      // Get column info using PRAGMA
      const schemaResult = await adapter.execute(
        `PRAGMA table_info("${tableName}")`,
        []
      );

      const columnInfo = schemaResult.rows.map((row) => {
        const r = row as Record<string, unknown>;
        return {
          name: r['name'] as string,
          type: r['type'] as string,
          pk: r['pk'] as number
        };
      });

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

      setRows(rowsResult.rows);
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

  // Reset sort state when table name changes
  useEffect(() => {
    if (tableName) {
      setSort({ column: null, direction: null });
    }
  }, [tableName]);

  // Fetch data on initial load, or when the table or sort order changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: loading is intentionally omitted to prevent infinite loop
  useEffect(() => {
    if (isUnlocked && !loading) {
      fetchTableData();
    }
  }, [isUnlocked, fetchTableData]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link
            to="/tables"
            className="inline-flex items-center text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Link>
          <h1 className="font-bold font-mono text-2xl tracking-tight">
            {tableName}
          </h1>
        </div>
        {isUnlocked && (
          <div className="flex items-center gap-2">
            <Button
              variant={documentView ? 'default' : 'outline'}
              size="icon"
              onClick={() => setDocumentView(!documentView)}
              title="Toggle document view"
            >
              <Braces className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={fetchTableData}
              disabled={loading}
            >
              <RefreshCw
                className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`}
              />
              Refresh
            </Button>
          </div>
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
            Database is locked. Unlock it from the Debug page to view table
            data.
          </p>
        </div>
      )}

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
              <table className="min-w-full divide-y divide-border">
                <thead className="bg-muted/50">
                  <tr>
                    {columns.map((col) => (
                      <th
                        key={col.name}
                        className="px-4 py-3 text-left font-medium text-muted-foreground text-xs uppercase tracking-wider"
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
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border bg-background">
                  {rows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={columns.length}
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
                        {columns.map((col) => (
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

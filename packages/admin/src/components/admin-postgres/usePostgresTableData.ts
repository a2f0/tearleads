import type { PostgresColumnInfo } from '@tearleads/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';

const PAGE_SIZE = 50;

export type SortDirection = 'asc' | 'desc' | null;

export interface SortState {
  column: string | null;
  direction: SortDirection;
}

export function usePostgresTableData(
  schema: string | null,
  tableName: string | null
) {
  const [columns, setColumns] = useState<PostgresColumnInfo[]>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const offsetRef = useRef<number>(0);
  const isLoadingMoreRef = useRef(false);
  const [initialLoadComplete, setInitialLoadComplete] = useState(false);

  const [sort, setSort] = useState<SortState>({
    column: null,
    direction: null
  });

  const fetchTableData = useCallback(
    async (reset = true) => {
      if (!schema || !tableName) return;

      setError(null);
      if (reset) {
        setLoading(true);
        setRows([]);
        offsetRef.current = 0;
        setInitialLoadComplete(false);
        isLoadingMoreRef.current = false;
      } else {
        if (isLoadingMoreRef.current) return;
        isLoadingMoreRef.current = true;
        setLoadingMore(true);
      }

      try {
        if (reset) {
          const columnsResponse = await api.admin.postgres.getColumns(
            schema,
            tableName
          );
          setColumns(columnsResponse.columns);
        }

        const rowsOptions: {
          limit: number;
          offset: number;
          sortColumn?: string;
          sortDirection?: 'asc' | 'desc';
        } = {
          limit: PAGE_SIZE,
          offset: reset ? 0 : offsetRef.current
        };
        if (sort.column) rowsOptions.sortColumn = sort.column;
        if (sort.direction) rowsOptions.sortDirection = sort.direction;

        const rowsResponse = await api.admin.postgres.getRows(
          schema,
          tableName,
          rowsOptions
        );

        if (reset) {
          setRows(rowsResponse.rows);
        } else {
          setRows((prev) => [...prev, ...rowsResponse.rows]);
        }

        setTotalCount(rowsResponse.totalCount);
        offsetRef.current += rowsResponse.rows.length;
        setHasMore(offsetRef.current < rowsResponse.totalCount);
      } catch (err) {
        console.error('Failed to fetch Postgres table data:', err);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
        setLoadingMore(false);
        if (reset) {
          setInitialLoadComplete(true);
        }
        isLoadingMoreRef.current = false;
      }
    },
    [schema, tableName, sort.column, sort.direction]
  );

  useEffect(() => {
    fetchTableData(true);
  }, [fetchTableData]);

  const handleSort = (columnName: string) => {
    setSort((prev) => {
      if (prev.column === columnName) {
        if (prev.direction === 'asc') {
          return { column: columnName, direction: 'desc' };
        } else if (prev.direction === 'desc') {
          return { column: null, direction: null };
        }
      }
      return { column: columnName, direction: 'asc' };
    });
  };

  return {
    columns,
    rows,
    loading,
    loadingMore,
    error,
    hasMore,
    totalCount,
    initialLoadComplete,
    sort,
    handleSort,
    fetchTableData,
    setError
  };
}

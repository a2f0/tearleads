import type { PostgresTableInfo } from '@tearleads/shared';

export type PostgresTableRow = {
  schema: string;
  name: string;
  row_count: number | string | null;
  total_bytes: number | string | null;
  table_bytes: number | string | null;
  index_bytes: number | string | null;
};

export function coerceNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export async function queryTableMetadata(pool: {
  query: <T>(sql: string) => Promise<{ rows: T[] }>;
}): Promise<PostgresTableInfo[]> {
  const result = await pool.query<PostgresTableRow>(`
    SELECT
      n.nspname AS schema,
      c.relname AS name,
      GREATEST(c.reltuples, 0)::bigint AS row_count,
      pg_total_relation_size(c.oid) AS total_bytes,
      pg_relation_size(c.oid) AS table_bytes,
      pg_indexes_size(c.oid) AS index_bytes
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p')
      AND n.nspname NOT IN ('pg_catalog', 'information_schema')
    ORDER BY n.nspname, c.relname
  `);

  return result.rows.map((row) => ({
    schema: row.schema,
    name: row.name,
    rowCount: coerceNumber(row.row_count),
    totalBytes: coerceNumber(row.total_bytes),
    tableBytes: coerceNumber(row.table_bytes),
    indexBytes: coerceNumber(row.index_bytes)
  }));
}

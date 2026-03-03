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

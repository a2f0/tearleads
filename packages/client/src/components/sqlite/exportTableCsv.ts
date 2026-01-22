import { isRecord } from '@rapid/shared';
import { getDatabaseAdapter } from '@/db';
import { createCsv } from '@/lib/csv';
import { downloadFile } from '@/lib/file-utils';

export interface ColumnInfo {
  name: string;
  type: string;
  pk: number;
}

export type ExportSortDirection = 'asc' | 'desc' | null | undefined;

export function getStringField(
  record: Record<string, unknown>,
  key: string
): string | null {
  const value = record[key];
  return typeof value === 'string' ? value : null;
}

export function getNumberField(
  record: Record<string, unknown>,
  key: string
): number | null {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function parseColumnInfo(schemaRows: unknown[]): ColumnInfo[] {
  return schemaRows
    .filter(isRecord)
    .map((row) => {
      const name = getStringField(row, 'name');
      const type = getStringField(row, 'type');
      const pk = getNumberField(row, 'pk');
      if (!name || !type || pk === null) {
        return null;
      }
      return { name, type, pk };
    })
    .filter((col): col is ColumnInfo => col !== null);
}

async function getValidTables(): Promise<string[]> {
  const adapter = getDatabaseAdapter();
  const tablesResult = await adapter.execute(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`,
    []
  );
  const tableRows = Array.isArray(tablesResult.rows) ? tablesResult.rows : [];
  return tableRows
    .filter(isRecord)
    .map((row) => getStringField(row, 'name'))
    .filter((name): name is string => Boolean(name));
}

interface ExportTableCsvOptions {
  tableName: string;
  columns?: ColumnInfo[];
  sortColumn?: string | null;
  sortDirection?: ExportSortDirection;
  onColumnsResolved?: (columns: ColumnInfo[]) => void;
}

export async function exportTableAsCsv({
  tableName,
  columns = [],
  sortColumn,
  sortDirection,
  onColumnsResolved
}: ExportTableCsvOptions): Promise<void> {
  const validTables = await getValidTables();
  if (!validTables.includes(tableName)) {
    throw new Error(`Table "${tableName}" does not exist.`);
  }

  let exportColumns = columns;
  if (exportColumns.length === 0) {
    const adapter = getDatabaseAdapter();
    const schemaResult = await adapter.execute(
      `PRAGMA table_info("${tableName}")`,
      []
    );
    const schemaRows = Array.isArray(schemaResult.rows)
      ? schemaResult.rows
      : [];
    exportColumns = parseColumnInfo(schemaRows);
    if (exportColumns.length > 0) {
      onColumnsResolved?.(exportColumns);
    }
  }

  if (exportColumns.length === 0) {
    throw new Error(`Table "${tableName}" has no columns to export.`);
  }

  const validColumns = exportColumns.map((col) => col.name);
  const sortableColumn =
    sortColumn && validColumns.includes(sortColumn) ? sortColumn : null;

  let query = `SELECT * FROM "${tableName}"`;
  if (sortableColumn && sortDirection) {
    const direction = sortDirection === 'desc' ? 'DESC' : 'ASC';
    query += ` ORDER BY "${sortableColumn}" ${direction}`;
  }

  const adapter = getDatabaseAdapter();
  const rowsResult = await adapter.execute(query, []);
  const rawRows = Array.isArray(rowsResult.rows) ? rowsResult.rows : [];
  const rowRecords = rawRows.filter(isRecord);
  const headers = exportColumns.map((col) => col.name);
  const csvRows = rowRecords.map((row) =>
    exportColumns.map((col) => row[col.name])
  );
  const csv = createCsv(headers, csvRows);
  const safeName = tableName.replace(/[<>:"/\\|?*]/g, '').trim() || 'table';
  const data = new TextEncoder().encode(csv);
  downloadFile(data, `${safeName}.csv`);
}

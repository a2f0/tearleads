import type { BackupSqlRow, BackupTable } from "./localBackupFormat";

export function requireBackupString(
  row: BackupSqlRow,
  column: string,
  label: string,
): string {
  const value = row[column];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} backup has an invalid ${column} value`);
  }
  return value;
}

export function requireBackupPositiveInteger(
  row: BackupSqlRow,
  column: string,
  label: string,
): number {
  const value = row[column];
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new Error(`${label} backup has an invalid ${column} value`);
  }
  return Number(value);
}

export function requireBackupHash(
  row: BackupSqlRow,
  column: string,
  label: string,
): string {
  const value = requireBackupString(row, column, label);
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`${label} backup has an invalid ${column} value`);
  }
  return value;
}

export function requireBackupTimestamp(
  row: BackupSqlRow,
  column: string,
  label: string,
): void {
  const value = requireBackupString(row, column, label);
  if (!Number.isFinite(Date.parse(value))) {
    throw new Error(`${label} backup has an invalid ${column} value`);
  }
}

export function validateBackupTableColumns(input: {
  readonly label: string;
  readonly requiredColumns: ReadonlyArray<string>;
  readonly table: BackupTable;
  readonly tableName: string;
}): void {
  if (input.table.name !== input.tableName) {
    throw new Error(`${input.label} backup table name is invalid`);
  }
  const columns = new Set(input.table.columns);
  if (
    columns.size !== input.requiredColumns.length ||
    input.table.columns.length !== input.requiredColumns.length
  ) {
    throw new Error(`${input.label} backup columns are invalid`);
  }
  for (const column of input.requiredColumns) {
    if (!columns.has(column)) {
      throw new Error(`${input.label} backup is missing the ${column} column`);
    }
  }
}

function backupScopeKey(input: {
  readonly columns: ReadonlyArray<string>;
  readonly label: string;
  readonly row: BackupSqlRow;
}): string {
  return JSON.stringify(
    input.columns.map((column) =>
      requireBackupString(input.row, column, input.label),
    ),
  );
}

export function mapBackupRowsByScope(input: {
  readonly label: string;
  readonly scopeColumns: ReadonlyArray<string>;
  readonly table: BackupTable;
  readonly validateRow: (row: BackupSqlRow) => void;
}): Map<string, BackupSqlRow> {
  const rows = new Map<string, BackupSqlRow>();
  for (const row of input.table.rows) {
    input.validateRow(row);
    const key = backupScopeKey({
      columns: input.scopeColumns,
      label: input.label,
      row,
    });
    if (rows.has(key)) {
      throw new Error(`${input.label} backup contains a duplicate scope`);
    }
    rows.set(key, row);
  }
  return rows;
}

export function uniqueBackupTableByName(
  tables: ReadonlyArray<BackupTable>,
  tableName: string,
): BackupTable | null {
  const matches = tables.filter((table) => table.name === tableName);
  if (matches.length > 1) {
    throw new Error(`Backup contains duplicate ${tableName} tables`);
  }
  return matches[0] ?? null;
}

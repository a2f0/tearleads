import type {
  ExecSql,
  SqlRow,
  SqlRowValue,
} from "../../src/data/sqlite/sqlSchema";

interface ColumnInfo {
  defaultValue: string | null;
  notNull: number;
  pk: number;
  type: string;
}

function readString(row: SqlRow, key: string): string {
  return String(row[key] ?? "");
}

function readNullableString(row: SqlRow, key: string): string | null {
  const value: SqlRowValue | undefined = row[key];
  return value === null || value === undefined ? null : String(value);
}

function readNumber(row: SqlRow, key: string): number {
  return Number(row[key] ?? 0);
}

/** The ONE PRAGMA table_info reader for schema tests. */
export async function readTableColumns(
  execSql: ExecSql,
  tableName: string,
): Promise<Record<string, ColumnInfo>> {
  const rows = await execSql(
    `PRAGMA table_info("${tableName.replaceAll('"', '""')}")`,
  );

  return Object.fromEntries(
    rows.map((row) => [
      readString(row, "name"),
      {
        defaultValue: readNullableString(row, "dflt_value"),
        notNull: readNumber(row, "notnull"),
        pk: readNumber(row, "pk"),
        type: readString(row, "type"),
      },
    ]),
  );
}

export function requireColumn(
  columns: Record<string, ColumnInfo>,
  name: string,
): ColumnInfo {
  const column = columns[name];
  if (!column) {
    throw new Error(`Missing column ${name}`);
  }

  return column;
}

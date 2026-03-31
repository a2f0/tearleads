import type { SqlRow, SqlRowValue } from "./AppDataProvider";

export type ExecSql = (
  sql: string,
  bind?: Record<string, SqlRowValue>,
) => Promise<SqlRow[]>;

export interface SqlColumnSchema {
  name: string;
  addSql: string;
}

export interface SqlTableSchema {
  name: string;
  createSql: string;
  requiredColumns?: ReadonlyArray<SqlColumnSchema>;
}

export function readSqlRowValue(
  row: SqlRow,
  key: string,
): SqlRowValue | undefined {
  return row[key];
}

export async function ensureSqlTables(
  execSql: ExecSql,
  tables: ReadonlyArray<SqlTableSchema>,
): Promise<void> {
  for (const table of tables) {
    await execSql(table.createSql);

    if (!table.requiredColumns || table.requiredColumns.length === 0) {
      continue;
    }

    const columns = await execSql(`PRAGMA table_info(${table.name})`);

    for (const requiredColumn of table.requiredColumns) {
      const hasColumn = columns.some(
        (column) => readSqlRowValue(column, "name") === requiredColumn.name,
      );

      if (!hasColumn) {
        await execSql(requiredColumn.addSql);
      }
    }
  }
}

import type { SqlRow, SqlRowValue } from "./AppDataProvider";

export type ExecSql = (
  sql: string,
  bind?: Record<string, SqlRowValue>,
) => Promise<SqlRow[]>;

export interface SqlTableSchema {
  name: string;
  createSql: string;
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
  }
}

export async function runSqlTransaction<T>(
  execSql: ExecSql,
  operation: () => Promise<T>,
): Promise<T> {
  await execSql("BEGIN");

  try {
    const result = await operation();
    await execSql("COMMIT");
    return result;
  } catch (error) {
    try {
      await execSql("ROLLBACK");
    } catch {
      // Ignore rollback errors so callers see the original failure.
    }

    throw error;
  }
}

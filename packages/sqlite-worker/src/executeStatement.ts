import type { Sqlite3Static } from "@symcrypt/sqlite-instance";
import type {
  DatabaseWorkerExecOptions,
  SqliteArrayRow,
  SqliteObjectRow,
  SqliteRow,
} from "./types";

/**
 * Run a prepared statement against an open database and collect its result rows
 * in the requested row mode (`array` tuples or `object` records).
 */
export function execDatabaseStatement(
  db: InstanceType<Sqlite3Static["oo1"]["DB"]>,
  options: DatabaseWorkerExecOptions,
): SqliteRow[] {
  if (options.rowMode === "array") {
    const rows: SqliteArrayRow[] = [];

    db.exec(options.sql, {
      ...(options.bind !== undefined ? { bind: options.bind } : {}),
      rowMode: "array",
      resultRows: rows,
    });

    return rows;
  }

  const rows: SqliteObjectRow[] = [];

  db.exec(options.sql, {
    ...(options.bind !== undefined ? { bind: options.bind } : {}),
    rowMode: "object",
    resultRows: rows,
  });

  return rows;
}

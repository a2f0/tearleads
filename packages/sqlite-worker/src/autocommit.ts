import type { Sqlite3Static } from "@tearleads/sqlite-instance";

/**
 * Whether the handle is outside any transaction. Every BEGIN, a SAVEPOINT
 * outside a transaction, and a statement that fails inside a multi-statement
 * string after its own BEGIN leave autocommit off; COMMIT, ROLLBACK, releasing
 * the outermost savepoint, and SQLite's own rollback after an error turn it
 * back on. A closed handle is in no transaction.
 */
export function isDatabaseInAutocommit(
  capi: Sqlite3Static["capi"],
  db: InstanceType<Sqlite3Static["oo1"]["DB"]>,
): boolean {
  return db.pointer === undefined || capi.sqlite3_get_autocommit(db) !== 0;
}

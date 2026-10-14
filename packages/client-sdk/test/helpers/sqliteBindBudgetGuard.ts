import { SQLITE_BOUND_VARIABLE_BUDGET } from "../../src/data/sqlite/sqliteBindBudget";
import { createExecSql, type ExecSql } from "../../src/data/sqlite/sqlSchema";

/**
 * Enforce SQLite's historical bound-variable budget on top of a test
 * database whose build allows more, so batching regressions fail locally.
 */
export function withSqliteBindBudget(execSql: ExecSql): ExecSql {
  return createExecSql({
    async exec({ sql, bind, rowMode }) {
      if (Array.isArray(bind) && bind.length > SQLITE_BOUND_VARIABLE_BUDGET) {
        throw new Error(
          `SQLite bound-variable budget exceeded: ${bind.length} variables`,
        );
      }
      if (rowMode === "array") {
        return { rows: await execSql(sql, bind, { rowMode: "array" }) };
      }
      if (rowMode === "object") {
        return { rows: await execSql(sql, bind, { rowMode: "object" }) };
      }
      return { rows: await execSql(sql, bind) };
    },
  });
}

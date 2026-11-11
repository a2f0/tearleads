import { createExecSql, type ExecSql } from "../../src/data/sqlite/sqlSchema";

/** Capture real SQLite executions without imposing a different runtime limit. */
export function captureStatements(execSql: ExecSql) {
  const statements: Array<{ sql: string; binds: number }> = [];
  const captured = createExecSql({
    async exec({ sql, bind, rowMode }) {
      statements.push({
        sql,
        binds: Array.isArray(bind)
          ? bind.length
          : Object.keys(bind ?? {}).length,
      });
      return {
        rows:
          rowMode === "array"
            ? await execSql(sql, bind, { rowMode: "array" })
            : await execSql(sql, bind),
      };
    },
  });
  return { execSql: captured, statements };
}

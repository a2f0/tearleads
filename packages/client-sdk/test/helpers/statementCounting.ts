import { createExecSql, type ExecSql } from "../../src/data/sqlite/sqlSchema";

/**
 * Wraps a test database so a statement-count test can measure one operation:
 * each SQLite statement is one worker message on the client.
 */
export function countingExecSql(execSql: ExecSql) {
  const counter = { statements: 0 };
  const counted = createExecSql({
    async exec({ sql, bind, rowMode }) {
      counter.statements += 1;
      const rows =
        rowMode === "array"
          ? await execSql(sql, bind, { rowMode: "array" })
          : await execSql(sql, bind);
      return { rows };
    },
  });
  /** Statements `run` issues, after the counter is reset. */
  const count = async (run: () => Promise<unknown>): Promise<number> => {
    counter.statements = 0;
    await run();
    return counter.statements;
  };
  return { count, counter, execSql: counted };
}

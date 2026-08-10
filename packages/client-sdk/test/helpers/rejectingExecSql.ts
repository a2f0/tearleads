import {
  createExecSql,
  type ExecSql,
  type ExecSqlClientLike,
} from "../../src/data/sqlite/sqlSchema";

/**
 * Wraps an ExecSql so statements matching `rejectSql` fail, letting denial
 * tests force projection purge failures while passing everything else through.
 */
export function createRejectingExecSql(
  execSql: ExecSql,
  rejectSql: (sql: string) => boolean,
): ExecSql {
  const client: ExecSqlClientLike = {
    async exec({ bind, rowMode, sql }) {
      if (rejectSql(sql)) {
        throw new Error("forced projection purge failure");
      }
      const rows =
        rowMode === "array"
          ? await execSql(sql, bind, { rowMode: "array" })
          : await execSql(sql, bind, { rowMode: "object" });
      return { rows };
    },
  };
  return createExecSql(client);
}

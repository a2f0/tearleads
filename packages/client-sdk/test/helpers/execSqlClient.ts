import type {
  ExecSql,
  ExecSqlClientLike,
} from "../../src/data/sqlite/sqlSchema";

/** Adapts a raw ExecSql function back into the client shape workflows accept. */
export function execSqlClientFromExecSql(execSql: ExecSql): ExecSqlClientLike {
  return {
    async exec({ bind, rowMode, sql }) {
      return {
        rows: await execSql(sql, bind, rowMode ? { rowMode } : undefined),
      };
    },
  };
}

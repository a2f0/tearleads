import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { createExecSql, type ExecSql } from "../sqlite/sqlSchema";
import { savePrincipalHistoryPrefix } from "./principalHistoryPrefixPersistence";

test("stage reclamation selects its bounded batch through the scope index", async () => {
  const f = await createTestExecSql("principal-stage-retention-plan");
  let selection: { sql: string; bind: Parameters<ExecSql>[1] } | undefined;
  const execSql = createExecSql({
    exec: async ({ sql, bind, rowMode }) => {
      if (
        sql.startsWith("select ") &&
        sql.includes('from "principal_history_stage_scopes" inner join')
      )
        selection = { sql, bind };
      return {
        rows: await f.execSql(sql, bind, rowMode ? { rowMode } : undefined),
      };
    },
  });
  try {
    await savePrincipalHistoryPrefix({
      indexRootHash: "opaque-index-root",
      execSql,
      stillCurrent: () => true,
      prefix: {
        scopeId: "indexed-scope",
        organizationId: "org-1",
        version: 100,
        currentJson: "{}",
        headJson: "{}",
        progress: "opaque-prefix",
      },
    });
    if (!selection) throw new Error("Missing production reclamation query");
    const plan = await f.execSql(
      `EXPLAIN QUERY PLAN ${selection.sql}`,
      selection.bind,
    );
    const details = plan.map((row) => String(Reflect.get(row, "detail")));
    expect(details).toContainEqual(
      expect.stringContaining("principal_history_stage_scopes_scope_idx"),
    );
    expect(details.some((detail) => detail.includes("USE TEMP B-TREE"))).toBe(
      false,
    );
    expect(details.some((detail) => detail.startsWith("SCAN "))).toBe(false);
  } finally {
    f.close();
  }
});

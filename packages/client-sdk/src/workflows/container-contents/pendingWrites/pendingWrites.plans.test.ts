import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { createExecSql, type ExecSql } from "../../../data/sqlite/sqlSchema";
import { listPendingWrites } from "./index";

// The write-queue listing reads only queued history rows: every statement that
// filters on `update_id IS NOT NULL` walks the queued-rows partial index
// instead of every history row of every document.
test("the write-queue listing reads queued history through the queued-rows index", async () => {
  const f = await createTestExecSql("pending-writes-plans");
  const statements: Array<{ bind: Parameters<ExecSql>[1]; sql: string }> = [];
  const execSql = createExecSql({
    exec: async ({ sql, bind, rowMode }) => {
      if (/update_id IS NOT NULL/i.test(sql)) statements.push({ bind, sql });
      return {
        rows: await f.execSql(sql, bind, rowMode ? { rowMode } : undefined),
      };
    },
  });
  try {
    await listPendingWrites(execSql);
    expect(statements.length).toBeGreaterThanOrEqual(2);
    for (const statement of statements) {
      const plan = await f.execSql(
        `EXPLAIN QUERY PLAN ${statement.sql}`,
        statement.bind,
      );
      const details = plan.map((row) => String(Reflect.get(row, "detail")));
      const historyReads = details.filter((detail) =>
        /^(SCAN|SEARCH) (document_history_updates|pending)\b/.test(detail),
      );
      expect(historyReads.length).toBeGreaterThan(0);
      for (const detail of historyReads)
        expect(detail).toContain("document_history_updates_queued_scope_idx");
    }
  } finally {
    f.close();
  }
});

// The deferred-tail scan repeats the partial index's condition, so it walks
// only records whose marker differs from their content frontier; a settled
// record never reaches the coverage check.
test("the deferred-tail scan reads only unsettled records through their index", async () => {
  const f = await createTestExecSql("deferred-tail-plans");
  const statements: Array<{ bind: Parameters<ExecSql>[1]; sql: string }> = [];
  const execSql = createExecSql({
    exec: async ({ sql, bind, rowMode }) => {
      if (/AS document_name/.test(sql)) statements.push({ bind, sql });
      return {
        rows: await f.execSql(sql, bind, rowMode ? { rowMode } : undefined),
      };
    },
  });
  try {
    await listPendingWrites(execSql);
    expect(statements).toHaveLength(1);
    const [statement] = statements;
    if (!statement) throw new Error("deferred-tail scan was not issued");
    const plan = await f.execSql(
      `EXPLAIN QUERY PLAN ${statement.sql}`,
      statement.bind,
    );
    const details = plan.map((row) => String(Reflect.get(row, "detail")));
    expect(details).toContain(
      "SCAN stored USING INDEX documents_deferred_tail_idx",
    );
    expect(details.filter((detail) => /^SCAN stored$/.test(detail))).toEqual(
      [],
    );
  } finally {
    f.close();
  }
});

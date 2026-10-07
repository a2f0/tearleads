import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { principalHistoryStageScopes } from "../sqlite/principalHistoryRetentionSchema";
import {
  principalHistoryStages,
  principalHistoryStageTables,
} from "../sqlite/principalHistoryStageSchema";
import { getClientSQLitePersistenceRuntime } from "../sqlite/sqlitePersistenceRuntime";
import {
  createExecSql,
  type ExecSql,
  ensureSqlTables,
} from "../sqlite/sqlSchema";
import { savePrincipalHistoryStage } from "./principalHistoryStagePersistence";

async function seededProgress(count: number) {
  const f = await createTestExecSql("principal-incomplete-retention");
  await ensureSqlTables(f.execSql, principalHistoryStageTables);
  const { db } = getClientSQLitePersistenceRuntime(f.execSql);
  const rows = Array.from({ length: count }, (_, index) => ({
    id: `old-${index}`,
    organizationId: "org-1",
    currentJson: "{}",
    afterVersion: 32,
    complete: false,
    progress: `progress-${index}`,
  }));
  await db.insert(principalHistoryStages).values(rows);
  await db.insert(principalHistoryStageScopes).values(
    rows.map((row, index) => ({
      id: row.id,
      organizationId: row.organizationId,
      scopeId: "scope-1",
      afterVersion: row.afterVersion,
      complete: row.complete,
      // Hints may be skewed: the current writer must survive regardless.
      touchedAt: Number.MAX_SAFE_INTEGER - count + index,
    })),
  );
  const stage = {
    id: "current",
    organizationId: "org-1",
    currentJson: "{}",
    afterVersion: 1,
    complete: false,
    progress: "current-progress",
  };
  return {
    ...f,
    db,
    input: {
      execSql: f.execSql,
      stage,
      previousProgress: null,
      evidence: {
        scopeId: "scope-1",
        organizationId: "org-1",
        entries: [],
        nodes: [],
      },
      stillCurrent: () => true,
    },
    snapshot: async () => ({
      stages: await db.select().from(principalHistoryStages),
      hints: await db.select().from(principalHistoryStageScopes),
    }),
  };
}

test("partial reclamation is bounded, scoped and preserves the current writer despite skewed recency", async () => {
  const f = await seededProgress(25);
  try {
    const protectedRows = [
      { ...f.input.stage, id: "complete", complete: true },
      { ...f.input.stage, id: "foreign-scope" },
      { ...f.input.stage, id: "foreign-organization", organizationId: "org-2" },
    ];
    await f.db.insert(principalHistoryStages).values(protectedRows);
    await f.db.insert(principalHistoryStageScopes).values(
      protectedRows.map((stage) => ({
        id: stage.id,
        organizationId: stage.organizationId,
        scopeId: stage.id === "foreign-scope" ? "scope-2" : "scope-1",
        afterVersion: stage.afterVersion,
        complete: stage.complete,
        touchedAt: 0,
      })),
    );
    await savePrincipalHistoryStage(f.input);
    const first = await f.snapshot();
    expect(first.stages).toHaveLength(13);
    expect(first.stages).toContainEqual(f.input.stage);
    const next = {
      ...f.input.stage,
      afterVersion: 2,
      progress: "next-progress",
    };
    await savePrincipalHistoryStage({
      ...f.input,
      stage: next,
      previousProgress: f.input.stage.progress,
    });
    const second = await f.snapshot();
    expect(second.stages).toHaveLength(11);
    for (const stage of protectedRows)
      expect(second.stages).toContainEqual(stage);
    expect(second.stages).toContainEqual(next);
    expect(second.hints.map(({ id }) => id).sort()).toEqual(
      second.stages.map(({ id }) => id).sort(),
    );
    const lost = {
      ...f.input.stage,
      id: "old-0",
      progress: "resumed-progress",
    };
    await expect(
      savePrincipalHistoryStage({
        ...f.input,
        stage: lost,
        previousProgress: "progress-0",
      }),
    ).rejects.toMatchObject({ code: "principal_history_stage_changed" });
    expect(await f.snapshot()).toEqual(second);
    await savePrincipalHistoryStage({ ...f.input, stage: lost });
    expect((await f.snapshot()).stages).toContainEqual(lost);
  } finally {
    f.close();
  }
});

test("cancellation rolls back the accepted page and its incomplete-stage reclamation", async () => {
  const f = await seededProgress(8);
  let current = true;
  let deleted = 0;
  const execSql = createExecSql({
    exec: async ({ sql, bind, rowMode }) => {
      const rows = await f.execSql(
        sql,
        bind,
        rowMode ? { rowMode } : undefined,
      );
      if (sql.startsWith('delete from "principal_history_stages"')) {
        deleted++;
        current = false;
      }
      return { rows };
    },
  });
  try {
    const before = await f.snapshot();
    await expect(
      savePrincipalHistoryStage({
        ...f.input,
        execSql,
        stillCurrent: () => current,
      }),
    ).rejects.toThrow();
    expect(deleted).toBe(1);
    expect(await f.snapshot()).toEqual(before);
  } finally {
    f.close();
  }
});

test("partial cleanup uses the recency index without sorting all staged rows", async () => {
  const f = await seededProgress(9);
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
    await savePrincipalHistoryStage({ ...f.input, execSql });
    if (!selection) throw new Error("Missing production reclamation query");
    const plan = await f.execSql(
      `EXPLAIN QUERY PLAN ${selection.sql}`,
      selection.bind,
    );
    const details = plan.map((row) => String(Reflect.get(row, "detail")));
    expect(details).toContainEqual(
      expect.stringContaining("principal_history_stage_scopes_incomplete_idx"),
    );
    expect(details.some((detail) => detail.includes("USE TEMP B-TREE"))).toBe(
      false,
    );
    expect(details.some((detail) => detail.startsWith("SCAN "))).toBe(false);
  } finally {
    f.close();
  }
});

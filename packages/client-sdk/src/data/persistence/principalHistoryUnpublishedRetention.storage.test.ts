import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { seededCompletedRetention } from "../../../test/helpers/principalCompletedRetention";
import { principalHistoryStageScopes } from "../sqlite/principalHistoryRetentionSchema";
import { principalHistoryStages } from "../sqlite/principalHistoryStageSchema";
import { createExecSql, type ExecSql } from "../sqlite/sqlSchema";
import { savePrincipalHistoryStage } from "./principalHistoryStagePersistence";

test("completed attempts converge in bounded batches while protecting published heads and scope", async () => {
  const f = await seededCompletedRetention(25, 2);
  try {
    const retained = [
      { ...f.input.stage, id: "incomplete", complete: false },
      { ...f.input.stage, id: "foreign-scope" },
      { ...f.input.stage, id: "foreign-organization", organizationId: "org-2" },
    ];
    await f.db.insert(principalHistoryStages).values(retained);
    await f.db.insert(principalHistoryStageScopes).values(
      retained.map((stage) => ({
        ...stage,
        scopeId: stage.id === "foreign-scope" ? "scope-2" : "scope-1",
        touchedAt: 0,
      })),
    );
    await savePrincipalHistoryStage(f.input);
    const first = await f.snapshot();
    expect(first.stages).toHaveLength(13);
    expect(first.stages).toContainEqual(f.input.stage);
    const stage = { ...f.input.stage, progress: "next-progress" };
    await savePrincipalHistoryStage({
      ...f.input,
      stage,
      previousProgress: f.input.stage.progress,
    });
    const saved = await f.snapshot();
    expect(saved.stages).toHaveLength(11);
    for (const row of retained) expect(saved.stages).toContainEqual(row);
    expect(saved.stages).toContainEqual(stage);
    for (const id of ["old-0", "old-1"])
      expect(saved.stages.some((row) => row.id === id)).toBe(true);
    expect(saved.hints.map(({ id }) => id)).toEqual(
      saved.stages.map(({ id }) => id),
    );
    expect(saved.prefixes).toEqual(first.prefixes);
    const lost = f.rows[2];
    if (!lost) throw new Error("Missing evicted writer");
    await expect(
      savePrincipalHistoryStage({
        ...f.input,
        stage: { ...lost, progress: "resumed-progress" },
        previousProgress: lost.progress,
      }),
    ).rejects.toMatchObject({ code: "principal_history_stage_changed" });
    expect(await f.snapshot()).toEqual(saved);
  } finally {
    f.close();
  }
});

test.each([false, true])(
  "completed limit counts an already protected writer correctly: published=%s",
  async (published) => {
    const f = await seededCompletedRetention(9, published ? 2 : undefined);
    try {
      const previous = published ? f.rows[0] : undefined;
      const stage = previous
        ? { ...previous, progress: "resumed" }
        : f.input.stage;
      await savePrincipalHistoryStage({
        ...f.input,
        stage,
        previousProgress: previous?.progress ?? null,
      });
      const saved = await f.snapshot();
      expect(saved.stages).toHaveLength(8);
      expect(saved.stages).toContainEqual(stage);
      expect(saved.stages.some((row) => row.id === "old-1")).toBe(published);
    } finally {
      f.close();
    }
  },
);

test("stale completion and version hints cannot evict a different actual stage", async () => {
  const f = await seededCompletedRetention(10, 2);
  try {
    await f.db
      .update(principalHistoryStages)
      .set({ complete: false })
      .where(eq(principalHistoryStages.id, "old-2"));
    await f.db
      .update(principalHistoryStages)
      .set({ afterVersion: 200 })
      .where(eq(principalHistoryStages.id, "old-3"));
    await savePrincipalHistoryStage(f.input);
    const saved = await f.snapshot();
    expect(saved.stages.find((row) => row.id === "old-2")).toMatchObject({
      complete: false,
    });
    expect(saved.stages.find((row) => row.id === "old-3")).toMatchObject({
      afterVersion: 200,
    });
    expect(saved.stages).toHaveLength(10);
    expect(saved.stages.some((row) => row.id === "old-4")).toBe(false);
  } finally {
    f.close();
  }
});

test("cancellation rolls back completed acceptance and reclamation", async () => {
  const f = await seededCompletedRetention(9, 2);
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
        deleted += 1;
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
    ).rejects.toMatchObject({ name: "ProjectionVerificationCancelledError" });
    expect(deleted).toBe(1);
    expect(await f.snapshot()).toEqual(before);
  } finally {
    f.close();
  }
});

test("completed reclamation uses the scoped recency index without an all-stage sort", async () => {
  const f = await seededCompletedRetention(9, 2);
  let selected: { sql: string; bind: Parameters<ExecSql>[1] } | undefined;
  const execSql = createExecSql({
    exec: async ({ sql, bind, rowMode }) => {
      if (
        sql.startsWith("select ") &&
        sql.includes('"principal_history_stages"."current_json"') &&
        sql.includes('from "principal_history_stage_scopes" inner join')
      )
        selected = { sql, bind };
      return {
        rows: await f.execSql(sql, bind, rowMode ? { rowMode } : undefined),
      };
    },
  });
  try {
    await savePrincipalHistoryStage({ ...f.input, execSql });
    if (!selected) throw new Error("Missing completed reclamation selection");
    const plan = await f.execSql(
      `EXPLAIN QUERY PLAN ${selected.sql}`,
      selected.bind,
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

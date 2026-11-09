import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { principalHistoryNodes } from "../../sqlite/schema/principalHistoryEvidenceSchema";
import { principalHistoryStages } from "../../sqlite/schema/principalHistoryStageSchema";
import { getClientSQLitePersistenceRuntime } from "../../sqlite/sqlitePersistenceRuntime";
import {
  discardPrincipalHistoryStage,
  savePrincipalHistoryStage,
} from "./principalHistoryStagePersistence";

test("discarding a missing stage initializes its tables on a fresh database", async () => {
  const f = await createTestExecSql("principal-stage-cold-discard");
  try {
    await discardPrincipalHistoryStage(
      f.execSql,
      {
        id: "absent-stage",
        organizationId: "org-1",
        currentJson: "{}",
        afterVersion: 0,
        complete: false,
        progress: "absent-progress",
      },
      () => true,
    );
    const { db } = getClientSQLitePersistenceRuntime(f.execSql);
    expect(await db.select().from(principalHistoryStages)).toEqual([]);
  } finally {
    f.close();
  }
});

test("a stale discard preserves newer stage progress and its scope hint", async () => {
  const f = await createTestExecSql("principal-stage-stale-discard");
  try {
    const stage = {
      id: "stage-1",
      organizationId: "org-1",
      currentJson: "{}",
      afterVersion: 1,
      complete: false,
      progress: "initial-progress",
    };
    const input = {
      execSql: f.execSql,
      stage,
      previousProgress: null,
      evidence: {
        indexRootHash: "opaque-index-root",
        scopeId: "scope-1",
        organizationId: "org-1",
        entries: [],
        nodes: [],
      },
      stillCurrent: () => true,
    };
    await savePrincipalHistoryStage(input);
    const newer = { ...stage, afterVersion: 2, progress: "newer-progress" };
    await savePrincipalHistoryStage({
      ...input,
      stage: newer,
      evidence: { ...input.evidence, indexRootHash: "newer-index-root" },
      previousProgress: stage.progress,
    });
    const { db } = getClientSQLitePersistenceRuntime(f.execSql);
    const saved = await db.select().from(principalHistoryStages);
    expect(saved).toMatchObject([
      { ...newer, scopeId: "scope-1", rootHash: "newer-index-root" },
    ]);
    await discardPrincipalHistoryStage(f.execSql, stage, () => true);
    expect(await db.select().from(principalHistoryStages)).toEqual(saved);
    await discardPrincipalHistoryStage(f.execSql, newer, () => true);
    expect(await db.select().from(principalHistoryStages)).toEqual([]);
    // Both roots lost their stage's edge: the replaced one on save, the last on discard.
    expect(
      await db
        .select({
          hash: principalHistoryNodes.hash,
          referenceCount: principalHistoryNodes.referenceCount,
        })
        .from(principalHistoryNodes)
        .orderBy(principalHistoryNodes.hash),
    ).toEqual([
      { hash: "newer-index-root", referenceCount: 0 },
      { hash: "opaque-index-root", referenceCount: 0 },
    ]);
  } finally {
    f.close();
  }
});

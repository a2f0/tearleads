import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { principalHistoryRootOwners } from "../sqlite/principalHistoryNodeRetentionSchema";
import { principalHistoryStageScopes } from "../sqlite/principalHistoryRetentionSchema";
import { principalHistoryStages } from "../sqlite/principalHistoryStageSchema";
import { getClientSQLitePersistenceRuntime } from "../sqlite/sqlitePersistenceRuntime";
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
    expect(await db.select().from(principalHistoryStageScopes)).toEqual([]);
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
    const hints = await db.select().from(principalHistoryStageScopes);
    expect(hints).toHaveLength(1);
    const owners = await db.select().from(principalHistoryRootOwners);
    expect(owners).toMatchObject([{ rootHash: "newer-index-root" }]);
    await discardPrincipalHistoryStage(f.execSql, stage, () => true);
    expect(await db.select().from(principalHistoryStages)).toEqual([newer]);
    expect(await db.select().from(principalHistoryStageScopes)).toEqual(hints);
    expect(await db.select().from(principalHistoryRootOwners)).toEqual(owners);
    await discardPrincipalHistoryStage(f.execSql, newer, () => true);
    expect(await db.select().from(principalHistoryStages)).toEqual([]);
    expect(await db.select().from(principalHistoryStageScopes)).toEqual([]);
    expect(await db.select().from(principalHistoryRootOwners)).toEqual([]);
  } finally {
    f.close();
  }
});

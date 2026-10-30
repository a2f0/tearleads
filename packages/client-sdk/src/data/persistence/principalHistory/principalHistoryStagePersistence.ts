import { and, eq } from "drizzle-orm";
import { assertProjectionVerificationCurrent } from "../../keyingProjectionVerification/types";
import { principalHistoryEvidenceTables } from "../../sqlite/schema/principalHistoryEvidenceSchema";
import { principalHistoryNodeRetentionTables } from "../../sqlite/schema/principalHistoryNodeRetentionSchema";
import {
  principalHistoryStages,
  principalHistoryStageTables,
} from "../../sqlite/schema/principalHistoryStageSchema";
import { getClientSQLitePersistenceRuntime } from "../../sqlite/sqlitePersistenceRuntime";
import { type ExecSql, ensureSqlTables } from "../../sqlite/sqlSchema";
import {
  type PrincipalHistoryEvidencePage,
  writePrincipalHistoryEvidencePage,
} from "./principalHistoryEvidencePersistence";
import { reclaimIncompletePrincipalHistoryStages } from "./principalHistoryIncompleteRetention";
import { reclaimPrincipalHistoryNodes } from "./principalHistoryNodeRetention";
import {
  foldablePrincipalHistoryRootEdges,
  loadPrincipalHistoryRootRetention,
  releasePrincipalHistoryRoot,
  writePrincipalHistoryRootRetention,
} from "./principalHistoryRootOwnership";
import { reclaimUnpublishedPrincipalHistoryStages } from "./principalHistoryUnpublishedRetention";

/** A stage's verification work; its retention hints are written by persistence. */
export type PrincipalHistoryStage = Omit<
  typeof principalHistoryStages.$inferSelect,
  "scopeId" | "touchedAt"
>;

const principalHistoryStageColumns = {
  id: principalHistoryStages.id,
  organizationId: principalHistoryStages.organizationId,
  currentJson: principalHistoryStages.currentJson,
  afterVersion: principalHistoryStages.afterVersion,
  complete: principalHistoryStages.complete,
  progress: principalHistoryStages.progress,
};

class PrincipalHistoryStageChangedError extends Error {
  readonly code = "principal_history_stage_changed";
  constructor() {
    super(
      "Another operation changed the saved principal history; resume from its current state",
    );
    this.name = "PrincipalHistoryStageChangedError";
  }
}

/** Another writer replaced this stage's progress between load and save. */
export function isPrincipalHistoryStageChangedError(error: unknown): boolean {
  return error instanceof PrincipalHistoryStageChangedError;
}

export async function loadPrincipalHistoryStage(
  execSql: ExecSql,
  id: string,
): Promise<PrincipalHistoryStage | null> {
  await ensureSqlTables(execSql, principalHistoryStageTables);
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const [row] = await db
    .select(principalHistoryStageColumns)
    .from(principalHistoryStages)
    .where(eq(principalHistoryStages.id, id))
    .limit(1);
  return row ?? null;
}

/** Publish accepted entries and index nodes atomically with authenticated progress. */
export async function savePrincipalHistoryStage(input: {
  readonly execSql: ExecSql;
  readonly stage: PrincipalHistoryStage;
  readonly evidence: PrincipalHistoryEvidencePage;
  readonly previousProgress: string | null;
  readonly stillCurrent: () => boolean;
}): Promise<void> {
  const evidence = structuredClone(input.evidence);
  const stage = { ...input.stage, scopeId: evidence.scopeId };
  await ensureSqlTables(input.execSql, [
    ...principalHistoryStageTables,
    ...principalHistoryEvidenceTables,
  ]);
  const runtime = getClientSQLitePersistenceRuntime(input.execSql);
  const saved = await runtime.guardedTransaction(
    async (tx) => {
      const [previous] = await tx
        .select({ progress: principalHistoryStages.progress })
        .from(principalHistoryStages)
        .where(eq(principalHistoryStages.id, stage.id))
        .limit(1);
      if ((previous?.progress ?? null) !== input.previousProgress)
        throw new PrincipalHistoryStageChangedError();
      // The node write replays the root's edges after the page's own, as
      // separate statements after it would.
      const retention = await loadPrincipalHistoryRootRetention(tx, {
        id: `stage:${stage.id}`,
        scopeId: evidence.scopeId,
        organizationId: stage.organizationId,
        rootHash: evidence.indexRootHash,
      });
      const rootEdges = foldablePrincipalHistoryRootEdges(retention, evidence);
      await writePrincipalHistoryEvidencePage(tx, evidence, rootEdges);
      const row = { ...stage, touchedAt: Date.now() };
      await tx
        .insert(principalHistoryStages)
        .values(row)
        .onConflictDoUpdate({ target: principalHistoryStages.id, set: row })
        .run();
      await writePrincipalHistoryRootRetention(tx, retention, rootEdges);
      await reclaimIncompletePrincipalHistoryStages(tx, stage);
      await reclaimUnpublishedPrincipalHistoryStages(tx, stage);
      await reclaimPrincipalHistoryNodes(tx, evidence);
    },
    input.stillCurrent,
    { behavior: "immediate" },
  );
  assertProjectionVerificationCurrent(() => saved.committed);
}

export async function discardPrincipalHistoryStage(
  execSql: ExecSql,
  stage: PrincipalHistoryStage,
  stillCurrent: () => boolean,
) {
  await ensureSqlTables(execSql, [
    ...principalHistoryStageTables,
    ...principalHistoryNodeRetentionTables,
  ]);
  const runtime = getClientSQLitePersistenceRuntime(execSql);
  const discarded = await runtime.guardedTransaction(
    async (db) => {
      const [current] = await db
        .select({ progress: principalHistoryStages.progress })
        .from(principalHistoryStages)
        .where(eq(principalHistoryStages.id, stage.id))
        .limit(1);
      if (current?.progress !== stage.progress) return;
      await releasePrincipalHistoryRoot(db, `stage:${stage.id}`);
      await db
        .delete(principalHistoryStages)
        .where(
          and(
            eq(principalHistoryStages.id, stage.id),
            eq(principalHistoryStages.progress, stage.progress),
          ),
        )
        .run();
    },
    stillCurrent,
    { behavior: "immediate" },
  );
  assertProjectionVerificationCurrent(() => discarded.committed);
}

import { and, eq } from "drizzle-orm";
import { assertProjectionVerificationCurrent } from "../keyingProjectionVerification/types";
import { principalHistoryEvidenceTables } from "../sqlite/principalHistoryEvidenceSchema";
import { principalHistoryNodeRetentionTables } from "../sqlite/principalHistoryNodeRetentionSchema";
import { principalHistoryStageScopes } from "../sqlite/principalHistoryRetentionSchema";
import {
  principalHistoryStages,
  principalHistoryStageTables,
} from "../sqlite/principalHistoryStageSchema";
import { getClientSQLitePersistenceRuntime } from "../sqlite/sqlitePersistenceRuntime";
import { type ExecSql, ensureSqlTables } from "../sqlite/sqlSchema";
import {
  type PrincipalHistoryEvidencePage,
  writePrincipalHistoryEvidencePage,
} from "./principalHistoryEvidencePersistence";
import { reclaimIncompletePrincipalHistoryStages } from "./principalHistoryIncompleteRetention";
import { reclaimPrincipalHistoryNodes } from "./principalHistoryNodeRetention";
import {
  releasePrincipalHistoryRoot,
  retainPrincipalHistoryRoot,
} from "./principalHistoryRootOwnership";
import { recordPrincipalHistoryStageScope } from "./principalHistoryStageRetention";
import { reclaimUnpublishedPrincipalHistoryStages } from "./principalHistoryUnpublishedRetention";

export type PrincipalHistoryStage = typeof principalHistoryStages.$inferSelect;

class PrincipalHistoryStageChangedError extends Error {
  readonly code = "principal_history_stage_changed";
  constructor() {
    super(
      "Another operation changed the saved principal history; resume from its current state",
    );
    this.name = "PrincipalHistoryStageChangedError";
  }
}

export async function loadPrincipalHistoryStage(execSql: ExecSql, id: string) {
  await ensureSqlTables(execSql, principalHistoryStageTables);
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const [row] = await db
    .select()
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
  const stage = { ...input.stage };
  const evidence = structuredClone(input.evidence);
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
      await writePrincipalHistoryEvidencePage(tx, evidence);
      await tx
        .insert(principalHistoryStages)
        .values(stage)
        .onConflictDoUpdate({ target: principalHistoryStages.id, set: stage })
        .run();
      await recordPrincipalHistoryStageScope(tx, {
        id: stage.id,
        afterVersion: stage.afterVersion,
        complete: stage.complete,
        organizationId: stage.organizationId,
        scopeId: evidence.scopeId,
      });
      await retainPrincipalHistoryRoot(tx, {
        id: `stage:${stage.id}`,
        scopeId: evidence.scopeId,
        organizationId: stage.organizationId,
        rootHash: evidence.indexRootHash,
      });
      await reclaimIncompletePrincipalHistoryStages(tx, {
        ...stage,
        scopeId: evidence.scopeId,
      });
      await reclaimUnpublishedPrincipalHistoryStages(tx, {
        ...stage,
        scopeId: evidence.scopeId,
      });
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
      await db
        .delete(principalHistoryStageScopes)
        .where(eq(principalHistoryStageScopes.id, stage.id))
        .run();
    },
    stillCurrent,
    { behavior: "immediate" },
  );
  assertProjectionVerificationCurrent(() => discarded.committed);
}

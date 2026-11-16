import { and, eq } from "drizzle-orm";
import { principalHistoryStages } from "../../sqlite/schema/principalHistoryStageSchema";
import type { ClientSQLiteTransactionScope } from "../../sqlite/sqlitePersistenceRuntime";
import {
  type PrincipalHistoryEvidencePage,
  writePrincipalHistoryEvidencePage,
} from "./principalHistoryEvidencePersistence";
import { reclaimIncompletePrincipalHistoryStages } from "./principalHistoryIncompleteRetention";
import { reclaimPrincipalHistoryNodes } from "./principalHistoryNodeRetention";
import {
  foldablePrincipalHistoryRootEdges,
  principalHistoryRootRetention,
  principalHistoryStageRootOwnerColumns,
  releasePrincipalHistoryRoot,
  writePrincipalHistoryRootEdges,
} from "./principalHistoryRootOwnership";
import { reclaimUnpublishedPrincipalHistoryStages } from "./principalHistoryUnpublishedRetention";

/** A stage's verification work; its retention hints are written by persistence. */
export type PrincipalHistoryStage = Omit<
  typeof principalHistoryStages.$inferSelect,
  "scopeId" | "touchedAt" | "rootHash" | "identityBundleFormat"
>;

export const principalHistoryStageColumns = {
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

/** Publish accepted entries and index nodes atomically with authenticated progress. */
export async function savePrincipalHistoryStageInTransaction(
  tx: ClientSQLiteTransactionScope,
  input: {
    readonly stage: PrincipalHistoryStage & { readonly scopeId: string };
    readonly evidence: PrincipalHistoryEvidencePage;
    readonly previousProgress: string | null;
  },
  touchedAt: number,
): Promise<void> {
  const { stage, evidence } = input;
  const [previous] = await tx
    .select({
      progress: principalHistoryStages.progress,
      ...principalHistoryStageRootOwnerColumns,
    })
    .from(principalHistoryStages)
    .where(eq(principalHistoryStages.id, stage.id))
    .limit(1);
  if ((previous?.progress ?? null) !== input.previousProgress)
    throw new PrincipalHistoryStageChangedError();
  // The node write replays the root's edges after the page's own, as
  // separate statements after it would.
  const root = {
    scopeId: evidence.scopeId,
    organizationId: stage.organizationId,
    rootHash: evidence.indexRootHash,
  };
  const retention = principalHistoryRootRetention(previous, root);
  const rootEdges = foldablePrincipalHistoryRootEdges(retention, evidence);
  await writePrincipalHistoryEvidencePage(tx, evidence, rootEdges);
  const row = { ...stage, ...root, touchedAt };
  await tx
    .insert(principalHistoryStages)
    .values(row)
    .onConflictDoUpdate({ target: principalHistoryStages.id, set: row })
    .run();
  await writePrincipalHistoryRootEdges(tx, retention, rootEdges);
  await reclaimIncompletePrincipalHistoryStages(tx, stage);
  await reclaimUnpublishedPrincipalHistoryStages(tx, stage);
  await reclaimPrincipalHistoryNodes(tx, evidence);
}

export async function discardPrincipalHistoryStageInTransaction(
  tx: ClientSQLiteTransactionScope,
  stage: PrincipalHistoryStage,
): Promise<void> {
  const [current] = await tx
    .select({
      progress: principalHistoryStages.progress,
      ...principalHistoryStageRootOwnerColumns,
    })
    .from(principalHistoryStages)
    .where(eq(principalHistoryStages.id, stage.id))
    .limit(1);
  if (!current || current.progress !== stage.progress) return;
  await releasePrincipalHistoryRoot(tx, current);
  await tx
    .delete(principalHistoryStages)
    .where(
      and(
        eq(principalHistoryStages.id, stage.id),
        eq(principalHistoryStages.progress, stage.progress),
      ),
    )
    .run();
}

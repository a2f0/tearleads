import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import type { MaterializedContainerRekeyPlan } from "../../data/containers/shared/types";
import { projectionVerificationOptions } from "../../data/documents/shared/types";
import type { PendingUpdateRecord } from "../../data/sqlite/documentPersistence";
import type { SyncRemoteDocumentInput } from "./readOnlySync";
import { buildAutomaticContainerRekeys } from "./syncAutomaticContainerRekeys";
import { requiresStandaloneAncestorRepairs } from "./syncContainerRekeyPreparation";
import { applyDocumentSyncContainerRekeys } from "./syncContainerRekeyProjection";
import { buildMaterializedDocumentSyncPlan } from "./syncPlanMaterial";
import { computeInlineRekeyCommitId } from "./syncRekeyCommit";
import { DocumentSyncPreparationRequiredError } from "./syncRepairAbandon";

/** Plan only: standalone server repairs belong to the outer sync attempt. */
export async function buildRemoteDocumentSyncPlan(input: {
  preparedRekeys?: readonly MaterializedContainerRekeyPlan[] | undefined;
  minLsn?: string | undefined;
  pendingUpdates: readonly PendingUpdateRecord[];
  pullCursor?: string | undefined;
  projection: DocumentWriterProjectionResponse;
  regenerateQueuedCheckpoints: boolean;
  sync: SyncRemoteDocumentInput;
}) {
  // Repairing this document's own container moves its key target hash, which
  // marks the content-key bundle stale. Only a pass that can build a rotation
  // snapshot is able to heal that; rotation settlement deliberately cannot
  // (`syncRequest.ts` omits the builder for `allowRecoveryBaseline: false`), so
  // repairing there would trade a classified "ancestor repair required" failure
  // for an unhealable bundle — after a standalone prefix may already have been
  // committed. Such a pass is left to fail as it did before automatic repair.
  const canHealStaleBundle = input.sync.buildRotationSnapshot !== undefined;
  let automaticPlans = input.preparedRekeys;
  if (
    input.pendingUpdates.length &&
    !input.sync.buildContainerRekeys &&
    canHealStaleBundle &&
    automaticPlans === undefined
  ) {
    const batch = await buildAutomaticContainerRekeys(
      input.sync,
      input.projection,
    );
    if (
      batch.hasMore ||
      (batch.plans.length > 0 && requiresStandaloneAncestorRepairs(input.sync))
    ) {
      throw new DocumentSyncPreparationRequiredError();
    }
    automaticPlans = batch.plans;
  }
  const rekeyPlans =
    input.pendingUpdates.length && input.sync.buildContainerRekeys
      ? await input.sync.buildContainerRekeys(input.projection, {
          persistVerificationCheckpoints: false,
        })
      : automaticPlans;
  const writerProjection = rekeyPlans?.length
    ? await applyDocumentSyncContainerRekeys({
        plans: rekeyPlans,
        writerProjection: input.projection,
      })
    : input.projection;
  let inlineRekeyCommitId: string | undefined;
  if (rekeyPlans?.length) {
    const headPendingUpdate = input.pendingUpdates[0];
    if (!headPendingUpdate) {
      throw new Error("Document inline rekey pending queue is empty");
    }
    inlineRekeyCommitId = await computeInlineRekeyCommitId({
      headPendingUpdateId: headPendingUpdate.id,
      projection: input.projection,
    });
  }
  return buildMaterializedDocumentSyncPlan({
    author: input.sync.author,
    buildRotationSnapshot: input.sync.buildRotationSnapshot,
    containerRekeys: rekeyPlans?.map(({ plan }) => plan.request),
    execSql: input.sync.execSql,
    historyMode: input.sync.historyMode,
    inlineRekeyCommitId,
    localVersionVector: input.sync.localVersionVector,
    minLsn: input.minLsn,
    onSyncTrace: input.sync.onSyncTrace,
    pendingUpdates: input.pendingUpdates,
    persistVerificationCheckpoints: rekeyPlans?.length ? false : undefined,
    pullCursor: input.pullCursor,
    regenerateQueuedCheckpoints: input.regenerateQueuedCheckpoints,
    signedAt: input.sync.signedAt,
    targetSecretKey: input.sync.targetSecretKey,
    writerProjection,
    ...projectionVerificationOptions(input.sync),
  });
}

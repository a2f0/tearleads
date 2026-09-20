import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import { projectionVerificationOptions } from "../../data/documents/shared/types";
import type { PendingUpdateRecord } from "../../data/sqlite/documentPersistence";
import type { SyncRemoteDocumentInput } from "./readOnlySync";
import { prepareAutomaticContainerRekeys } from "./syncContainerRekeyPreparation";
import { applyDocumentSyncContainerRekeys } from "./syncContainerRekeyProjection";
import { buildMaterializedDocumentSyncPlan } from "./syncPlanMaterial";
import { computeInlineRekeyCommitId } from "./syncRekeyCommit";

export async function buildRemoteDocumentSyncPlan(input: {
  minLsn?: string | undefined;
  pendingUpdates: readonly PendingUpdateRecord[];
  pullCursor?: string | undefined;
  projection: DocumentWriterProjectionResponse;
  regenerateQueuedCheckpoints: boolean;
  sync: SyncRemoteDocumentInput;
}) {
  const prepared =
    input.pendingUpdates.length && !input.sync.buildContainerRekeys
      ? await prepareAutomaticContainerRekeys(input.sync, input.projection)
      : { projection: input.projection, plans: undefined };
  const rekeyPlans =
    input.pendingUpdates.length && input.sync.buildContainerRekeys
      ? await input.sync.buildContainerRekeys(input.projection, {
          persistVerificationCheckpoints: false,
        })
      : prepared.plans;
  const writerProjection = rekeyPlans?.length
    ? await applyDocumentSyncContainerRekeys({
        plans: rekeyPlans,
        writerProjection: prepared.projection,
      })
    : prepared.projection;
  let inlineRekeyCommitId: string | undefined;
  if (rekeyPlans?.length) {
    const headPendingUpdate = input.pendingUpdates[0];
    if (!headPendingUpdate) {
      throw new Error("Document inline rekey pending queue is empty");
    }
    inlineRekeyCommitId = await computeInlineRekeyCommitId({
      headPendingUpdateId: headPendingUpdate.id,
      projection: prepared.projection,
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

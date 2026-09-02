import type { DocumentSyncResponse } from "@tearleads/validators/response";
import type { MaterializedDocumentSyncPlan } from "../../data/documents/shared/types";
import type { PendingUpdateRecord } from "../../data/sqlite/documentPersistence";
import { limitDocumentSyncRequestBytes } from "../../data/sync/documentSyncOutgoingBatch";

interface SyncPlanMaterial {
  readonly contentKey: Uint8Array;
  readonly healedStaleContentKeyBundle: boolean;
  readonly heldBackPendingUpdateIds: readonly string[];
  readonly staleRecoveryBaselineUpdateId?: string | undefined;
}

export function boundDocumentSyncPlanRequest(
  plan: MaterializedDocumentSyncPlan["plan"],
  requiredOutgoingUpdateId: string | undefined,
): MaterializedDocumentSyncPlan["plan"] {
  const request = limitDocumentSyncRequestBytes(plan.request, {
    requiredOutgoingUpdateId,
  });
  return request === plan.request ? plan : { ...plan, request };
}

export function materializedDocumentSyncPlan(
  material: SyncPlanMaterial,
  plan: MaterializedDocumentSyncPlan["plan"],
  writerProjection: MaterializedDocumentSyncPlan["writerProjection"],
): MaterializedDocumentSyncPlan {
  return {
    contentKey: material.contentKey,
    healedStaleContentKeyBundle: material.healedStaleContentKeyBundle,
    heldBackPendingUpdateIds: material.heldBackPendingUpdateIds,
    plan,
    writerProjection,
    ...(material.staleRecoveryBaselineUpdateId === undefined
      ? {}
      : {
          staleRecoveryBaselineUpdateId: material.staleRecoveryBaselineUpdateId,
        }),
  };
}

export function recoverablePendingUpdates(
  pendingUpdates: readonly PendingUpdateRecord[],
  materializedPlan: MaterializedDocumentSyncPlan,
): PendingUpdateRecord[] {
  const submittedIds = new Set(
    materializedPlan.plan.request.outgoingUpdates.map((update) => update.id),
  );
  const recoverableIds = new Set([
    ...submittedIds,
    ...materializedPlan.heldBackPendingUpdateIds,
  ]);
  return pendingUpdates.filter((update) => recoverableIds.has(update.id));
}

export function hasDeferredPendingUpdatesAfterSubmit(input: {
  acceptedRecoveryBaseline: boolean;
  exhaustedPendingUpdateCount: number;
  pendingUpdateIds: readonly string[];
  rekeyedPendingUpdateIds: readonly string[];
  settledPendingUpdateIds: readonly string[];
}): boolean {
  if (input.exhaustedPendingUpdateCount > 0) {
    return false;
  }

  const madeDurableProgress =
    input.acceptedRecoveryBaseline ||
    input.settledPendingUpdateIds.length > 0 ||
    input.rekeyedPendingUpdateIds.length > 0;
  if (!madeDurableProgress) {
    return false;
  }

  const settledPendingUpdateIds = new Set(input.settledPendingUpdateIds);
  return (
    input.rekeyedPendingUpdateIds.length > 0 ||
    input.pendingUpdateIds.some(
      (updateId) => !settledPendingUpdateIds.has(updateId),
    )
  );
}

export function responseAcceptedRecoveryBaseline(
  materializedPlan: MaterializedDocumentSyncPlan,
  response: DocumentSyncResponse,
): boolean {
  const recoveryBaselineId = materializedPlan.staleRecoveryBaselineUpdateId;
  return (
    recoveryBaselineId !== undefined &&
    response.acceptedOutgoingUpdateIds.includes(recoveryBaselineId)
  );
}

export function acceptedHeldBackPendingUpdateIds(
  materializedPlan: MaterializedDocumentSyncPlan,
  response: DocumentSyncResponse,
): readonly string[] {
  return responseAcceptedRecoveryBaseline(materializedPlan, response)
    ? materializedPlan.heldBackPendingUpdateIds
    : [];
}

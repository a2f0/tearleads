import type { DocumentSyncResponse } from "@symcrypt/validators/response";
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
): MaterializedDocumentSyncPlan {
  return {
    contentKey: material.contentKey,
    healedStaleContentKeyBundle: material.healedStaleContentKeyBundle,
    heldBackPendingUpdateIds: material.heldBackPendingUpdateIds,
    plan,
    ...(material.staleRecoveryBaselineUpdateId === undefined
      ? {}
      : {
          staleRecoveryBaselineUpdateId: material.staleRecoveryBaselineUpdateId,
        }),
  };
}

export function submittedPendingUpdates(
  pendingUpdates: readonly PendingUpdateRecord[],
  plan: MaterializedDocumentSyncPlan["plan"],
): PendingUpdateRecord[] {
  const submittedIds = new Set(
    plan.request.outgoingUpdates.map((update) => update.id),
  );
  return pendingUpdates.filter((update) => submittedIds.has(update.id));
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

import type { DocumentSyncResponse } from "@tearleads/validators/response";
import { limitDocumentSyncRequestBytes } from "../../../data/documents/shared/sync/documentSyncOutgoingBatch";
import type { MaterializedDocumentSyncPlan } from "../../../data/documents/shared/sync/documentSyncTypes";
import type { PendingUpdateRecord } from "../../../data/persistence/documents/records";

interface SyncPlanMaterial {
  readonly contentKey: Uint8Array;
  readonly healedStaleContentKeyBundle: boolean;
  readonly rotationBaseline?:
    | { readonly segments: readonly { readonly id: string }[] }
    | undefined;
}

/** The update ids of the baseline a plan's material carries, in order. */
export function rotationBaselineUpdateIdsOf(
  material: Pick<SyncPlanMaterial, "rotationBaseline">,
): readonly string[] | undefined {
  return material.rotationBaseline?.segments.map((segment) => segment.id);
}

export function boundDocumentSyncPlanRequest(
  plan: MaterializedDocumentSyncPlan["plan"],
  requiredOutgoingUpdateIds: readonly string[] | undefined,
): MaterializedDocumentSyncPlan["plan"] {
  const request = limitDocumentSyncRequestBytes(plan.request, {
    requiredOutgoingUpdateIds,
  });
  return request === plan.request ? plan : { ...plan, request };
}

export function materializedDocumentSyncPlan(
  material: SyncPlanMaterial,
  plan: MaterializedDocumentSyncPlan["plan"],
  writerProjection: MaterializedDocumentSyncPlan["writerProjection"],
): MaterializedDocumentSyncPlan {
  const rotationBaselineUpdateIds = rotationBaselineUpdateIdsOf(material);
  return {
    contentKey: material.contentKey,
    healedStaleContentKeyBundle: material.healedStaleContentKeyBundle,
    plan,
    writerProjection,
    ...(rotationBaselineUpdateIds === undefined
      ? {}
      : { rotationBaselineUpdateIds }),
  };
}

export function recoverablePendingUpdates(
  pendingUpdates: readonly PendingUpdateRecord[],
  materializedPlan: MaterializedDocumentSyncPlan,
): PendingUpdateRecord[] {
  const submittedIds = new Set(
    materializedPlan.plan.request.outgoingUpdates.map((update) => update.id),
  );
  return pendingUpdates.filter((update) => submittedIds.has(update.id));
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

/**
 * Whether the server accepted the plan's rotation baseline. The API commits
 * a baseline whole or refuses the request, so it acknowledges every segment
 * or none; anything else is not an accepted baseline.
 */
export function responseAcceptedRecoveryBaseline(
  materializedPlan: MaterializedDocumentSyncPlan,
  response: DocumentSyncResponse,
): boolean {
  const segmentIds = materializedPlan.rotationBaselineUpdateIds ?? [];
  const accepted = new Set(response.acceptedOutgoingUpdateIds);
  return segmentIds.length > 0 && segmentIds.every((id) => accepted.has(id));
}

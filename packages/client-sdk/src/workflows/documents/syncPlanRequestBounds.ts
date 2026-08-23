import type { MaterializedDocumentSyncPlan } from "../../data/documents/shared/types";
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

import type {
  DocumentCreateResponse,
  DocumentSyncResponse,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import type {
  DocumentSyncPlan,
  MaterializedDocumentSyncPlan,
} from "../../data/documents/shared/types";
import type { DocumentWriterProjectionAuthorization } from "../../data/keyingProjectionVerification";
import {
  boundDocumentSyncPlanRequest,
  materializedDocumentSyncPlan,
} from "./syncPlanRequestBounds";

interface SyncPlanProjectionMaterial {
  readonly contentKey: Uint8Array;
  readonly contentKeyBundle: DocumentCreateResponse["contentKeyBundle"];
  readonly documentKekTargets: DocumentSyncResponse["documentKekTargets"];
  readonly documentManifest: DocumentCreateResponse["accessManifest"];
  readonly healedStaleContentKeyBundle: boolean;
  readonly heldBackPendingUpdateIds: readonly string[];
  readonly staleRecoveryBaselineUpdateId?: string | undefined;
}

function writerProjectionAfterContentKeyHeal(
  material: SyncPlanProjectionMaterial,
  writerProjection: DocumentWriterProjectionResponse,
): DocumentWriterProjectionResponse {
  if (!material.healedStaleContentKeyBundle) return writerProjection;
  const healedProjection = {
    ...writerProjection,
    contentKeyBundle: material.contentKeyBundle,
    documentKekTargets: material.documentKekTargets,
    documentManifest: material.documentManifest,
  };
  delete healedProjection.contentKeyBundleStale;
  return healedProjection;
}

export function finalizeMaterializedDocumentSyncPlan(input: {
  readonly basePlan: DocumentSyncPlan;
  readonly material: SyncPlanProjectionMaterial;
  readonly writerAuthorization:
    | DocumentWriterProjectionAuthorization
    | undefined;
  readonly writerProjection: DocumentWriterProjectionResponse;
}): MaterializedDocumentSyncPlan {
  const unboundedPlan = input.writerAuthorization
    ? {
        ...input.basePlan,
        documentWriterAuthorization: input.writerAuthorization,
      }
    : input.basePlan;
  const plan = boundDocumentSyncPlanRequest(
    unboundedPlan,
    input.material.staleRecoveryBaselineUpdateId,
  );
  return materializedDocumentSyncPlan(
    input.material,
    plan,
    writerProjectionAfterContentKeyHeal(input.material, input.writerProjection),
  );
}

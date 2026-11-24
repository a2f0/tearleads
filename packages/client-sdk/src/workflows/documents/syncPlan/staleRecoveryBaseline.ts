import {
  emptyVersionVector,
  getImportBlobMetadata,
  satisfiesVersionVector,
  versionVectorsEqual,
} from "@tearleads/loro";
import { createPendingUpdateFields } from "../../../data/documents/documentSync";
import type { PendingUpdateRecord } from "../../../data/persistence/documents/records";

/**
 * Builds the rotation baseline that anchors a stale-bundle heal: a full
 * history snapshot of the local document, re-encrypted under the fresh
 * content key so every current member (including post-rotation newcomers)
 * has an efficient current-epoch redirect. Predecessor KEKs remain the
 * correctness path when no covering baseline exists.
 */
export async function buildStaleRecoveryBaselinePendingUpdate(
  buildRotationSnapshot: (() => Promise<Uint8Array | null>) | undefined,
): Promise<PendingUpdateRecord> {
  const snapshot = buildRotationSnapshot ? await buildRotationSnapshot() : null;
  if (!snapshot) {
    throw new Error(
      "Document content-key bundle is stale and no rotation snapshot is available to heal it",
    );
  }
  const metadata = getImportBlobMetadata(snapshot);
  if (
    metadata.mode !== "snapshot" ||
    !versionVectorsEqual(
      metadata.partialStartVersionVector,
      emptyVersionVector(),
    )
  ) {
    throw new Error(
      "Document stale-bundle recovery requires a full-history rotation snapshot",
    );
  }
  const pendingFields = createPendingUpdateFields(
    snapshot,
    metadata.partialEndVersionVector,
  );
  if (!pendingFields) {
    throw new Error("Document stale-bundle recovery snapshot is empty");
  }

  return {
    id: crypto.randomUUID(),
    ...pendingFields,
  };
}

/**
 * Settling a superseded checkpoint deletes its queue row, so the fresh
 * baseline must PROVABLY subsume it — assumed coverage would silently drop
 * any ops the checkpoint alone carried.
 */
export function assertRecoveryBaselineCoversCheckpoints(
  recoveryBaseline: PendingUpdateRecord,
  checkpoints: readonly PendingUpdateRecord[],
): void {
  for (const checkpoint of checkpoints) {
    if (
      !satisfiesVersionVector(
        recoveryBaseline.partialEndVersionVector,
        checkpoint.partialEndVersionVector,
      )
    ) {
      throw new Error(
        "Document stale-bundle recovery snapshot does not cover a queued rotation checkpoint",
      );
    }
  }
}

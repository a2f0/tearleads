import type { HistorySegmentSizes } from "@tearleads/loro";
import {
  type DocumentRotationBaselineHistory,
  segmentRotationSnapshot,
} from "./rotationBaselineGroup";

/**
 * Builds the rotation baseline that anchors a stale-bundle heal: the local
 * document's whole history, cut into segments that the plan encrypts under
 * the fresh content key, so every current member (including post-rotation
 * newcomers) has an efficient current-epoch redirect. Predecessor KEKs
 * remain the correctness path when no covering baseline exists.
 */
export async function buildStaleRecoveryBaseline(
  buildRotationSnapshot: (() => Promise<Uint8Array | null>) | undefined,
  segmentSizes?: HistorySegmentSizes | undefined,
): Promise<DocumentRotationBaselineHistory> {
  const snapshot = buildRotationSnapshot ? await buildRotationSnapshot() : null;
  if (!snapshot) {
    throw new Error(
      "Document content-key bundle is stale and no rotation snapshot is available to heal it",
    );
  }
  const history = segmentRotationSnapshot({
    purpose: "Document stale-bundle recovery",
    segmentSizes,
    snapshot,
  });
  if (history.segments.length === 0) {
    throw new Error("Document stale-bundle recovery snapshot is empty");
  }
  return history;
}

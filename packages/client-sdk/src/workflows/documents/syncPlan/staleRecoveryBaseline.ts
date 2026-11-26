import { type HistorySegmentSizes, versionVectorsEqual } from "@tearleads/loro";
import type { DocumentContentKeyBundleResponse } from "@tearleads/validators/response";
import type { DocumentBaselineStageApi } from "../../../data/documents/shared/sync/baselineStageApi";
import type { DocumentSyncPreparedUpdate } from "../../../data/documents/shared/sync/documentSyncTypes";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import { DocumentRotationBaselineStageError } from "../baselineStage/rotationBaselineErrors";
import type { RotationBaselineSigner } from "../baselineStage/rotationBaselineSigner";
import { writeRotationBaseline } from "../baselineStage/rotationBaselineWriter";
import type { DocumentSyncTraceEmitter } from "../sync/syncTrace";

/** The rotation baseline a heal's request carries ahead of its updates. */
export interface StaleRecoveryBaseline {
  /** The stage that holds the earlier segments, when the group is staged. */
  readonly baselineStageId?: string;
  /**
   * In index order: the whole group, or a staged group's final segment.
   * Encrypted for the fresh key; the plan signs them with its updates.
   */
  readonly segments: readonly DocumentSyncPreparedUpdate[];
}

/**
 * Builds the rotation baseline that anchors a stale-bundle heal: the local
 * document's whole history, cut into segments encrypted under the fresh
 * content key, so every current member (including post-rotation newcomers)
 * has an efficient current-epoch redirect. Predecessor KEKs remain the
 * correctness path when no covering baseline exists. A history too large
 * for the heal's request is uploaded to a stage, and the request carries
 * only its final segment.
 */
export async function writeStaleRecoveryBaseline(input: {
  readonly api: Partial<DocumentBaselineStageApi>;
  readonly buildRotationSnapshot:
    | (() => Promise<Uint8Array | null>)
    | undefined;
  readonly contentKey: Uint8Array;
  /** The healed bundle, which names the epoch the fresh key opens. */
  readonly contentKeyBundle: DocumentContentKeyBundleResponse;
  readonly execSql: ExecSql | undefined;
  /** The payload characters the group may total to travel whole. */
  readonly inlineCharacters: number;
  readonly onSyncTrace?: DocumentSyncTraceEmitter | undefined;
  readonly organizationId: string;
  readonly segmentSizes?: HistorySegmentSizes | undefined;
  readonly signedAt: string;
  readonly signer: RotationBaselineSigner;
  readonly stillCurrent?: (() => boolean) | undefined;
}): Promise<StaleRecoveryBaseline> {
  const snapshot = input.buildRotationSnapshot
    ? await input.buildRotationSnapshot()
    : null;
  if (!snapshot) {
    throw new Error(
      "Document content-key bundle is stale and no rotation snapshot is available to heal it",
    );
  }
  const baseline = await writeRotationBaseline({
    api: input.api,
    contentKey: input.contentKey,
    contentKeyEpoch: input.contentKeyBundle.contentKeyEpoch,
    documentId: input.contentKeyBundle.documentId,
    execSql: input.execSql,
    inlineCharacters: input.inlineCharacters,
    onTrace: input.onSyncTrace,
    organizationId: input.organizationId,
    plan: { linkSetEvent: undefined, signedAt: input.signedAt },
    purpose: "Document stale-bundle recovery",
    segmentSizes: input.segmentSizes,
    signer: input.signer,
    snapshot,
    stillCurrent: input.stillCurrent,
  });
  if (baseline.kind === "cancelled") {
    throw new DocumentRotationBaselineStageError(
      "Document stale-bundle recovery was cancelled while its baseline uploaded",
      undefined,
      null,
    );
  }
  // A heal sends queued writes, so its document holds their operations: a
  // history with none is not the document's.
  if (baseline.kind === "none" || baseline.segments.every(isEmptySegment)) {
    throw new Error("Document stale-bundle recovery snapshot is empty");
  }
  return baseline.kind === "staged"
    ? { baselineStageId: baseline.baselineStageId, segments: baseline.segments }
    : { segments: baseline.segments };
}

function isEmptySegment(segment: DocumentSyncPreparedUpdate): boolean {
  return versionVectorsEqual(
    segment.partialStartVersionVector,
    segment.partialEndVersionVector,
  );
}

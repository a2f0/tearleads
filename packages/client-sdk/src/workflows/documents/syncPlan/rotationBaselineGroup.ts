import {
  computeDocumentBaselineSegmentsDigest,
  type DocumentBaselineSegmentDigestEntry,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  createReadOnlyDocument,
  emptyVersionVector,
  exportAllUpdates,
  exportHistorySegments,
  getImportBlobMetadata,
  HistorySegmentCounterTooLargeError,
  type HistorySegmentSizes,
  importSnapshot,
  versionVectorsEqual,
} from "@tearleads/loro";
import { MAX_DOCUMENT_BASELINE_SEGMENTS } from "@tearleads/validators/util";
import { encryptDocumentPendingUpdate } from "../../../data/documents/shared/crypto";
import type { DocumentBaselineSegmentFields } from "../../../data/documents/shared/sync/baselineSegment";
import type { DocumentContentKey } from "../../../data/documents/shared/sync/contentKeyCommitment";
import { DocumentSyncRequestLimitError } from "../../../data/documents/shared/sync/documentSyncOutgoingBatch";
import type { DocumentSyncPreparedUpdate } from "../../../data/documents/shared/sync/documentSyncTypes";
import type { PendingUpdateRecord } from "../../../data/persistence/documents/records";

/**
 * A proven history cut into the segments of one rotation baseline: ordinary
 * update blobs that rebuild it when imported in order. The segments are
 * built for the request that rotates and are never queued.
 */
export interface DocumentRotationBaselineHistory {
  readonly baselineId: string;
  /** In index order. A history with no operations has none. */
  readonly segments: readonly PendingUpdateRecord[];
  /** The version the history reaches, which the segments reach together. */
  readonly version: string;
}

/** The base64 characters a baseline's payloads add to a request. */
export function rotationBaselineDataCharacters(
  history: DocumentRotationBaselineHistory,
): number {
  return history.segments.reduce(
    (sum, segment) => sum + segment.updateData.length,
    0,
  );
}

function assertFullHistorySnapshot(snapshot: Uint8Array, purpose: string) {
  const metadata = getImportBlobMetadata(snapshot);
  if (
    metadata.mode !== "snapshot" ||
    !versionVectorsEqual(
      metadata.partialStartVersionVector,
      emptyVersionVector(),
    )
  ) {
    throw new Error(`${purpose} requires a full-history rotation snapshot`);
  }
  return metadata;
}

/**
 * Cut the history in `snapshot`, the full-history snapshot a rotation proof
 * returned, into a baseline's segments. A holder restored from a snapshot
 * segments exactly as the document it came from, so the segments carry the
 * proven history and nothing else.
 *
 * A baseline travels in the one request that rotates. A history with more
 * segments than a request may carry, or with one operation larger than a
 * segment may be (`HistorySegmentCounterTooLargeError`: the author's own
 * data, which no retry makes smaller), cannot rotate in one request: both
 * throw `DocumentSyncRequestLimitError`, the failure an oversized queued
 * update ends in.
 */
export function segmentRotationSnapshot(input: {
  /** Names the caller in the error for a snapshot that is not one. */
  readonly purpose: string;
  readonly segmentSizes?: HistorySegmentSizes | undefined;
  readonly snapshot: Uint8Array;
}): DocumentRotationBaselineHistory {
  const metadata = assertFullHistorySnapshot(input.snapshot, input.purpose);
  const document = createReadOnlyDocument();
  const segments: PendingUpdateRecord[] = [];
  try {
    importSnapshot(document, input.snapshot);
    for (const segment of exportHistorySegments(document, input.segmentSizes)) {
      if (segments.length === MAX_DOCUMENT_BASELINE_SEGMENTS) {
        throw new DocumentSyncRequestLimitError(
          "Document rotation baseline has more segments than one request carries",
        );
      }
      segments.push({
        id: crypto.randomUUID(),
        partialEndVersionVector: segment.partialEndVersionVector,
        partialStartVersionVector: segment.partialStartVersionVector,
        updateData: bytesToBase64(segment.update),
      });
    }
  } catch (error) {
    if (error instanceof HistorySegmentCounterTooLargeError) {
      throw new DocumentSyncRequestLimitError(
        `Document rotation baseline cannot carry one operation: ${error.message}`,
      );
    }
    throw error;
  } finally {
    document.free();
  }
  return {
    baselineId: crypto.randomUUID(),
    segments,
    version: metadata.partialEndVersionVector,
  };
}

/**
 * The one segment of an empty baseline: an update blob with no operations.
 * Its author voided every update through the cursor the segment signs, so
 * the history it carries is empty, and the API asks the baseline to cover
 * only the updates after the cursor.
 */
export function emptyRotationBaselineSegment(): PendingUpdateRecord {
  const document = createReadOnlyDocument();
  try {
    const update = exportAllUpdates(document);
    const vectors = getImportBlobMetadata(update);
    return {
      id: crypto.randomUUID(),
      partialEndVersionVector: vectors.partialEndVersionVector,
      partialStartVersionVector: vectors.partialStartVersionVector,
      updateData: bytesToBase64(update),
    };
  } finally {
    document.free();
  }
}

/**
 * Encrypt a baseline's segments in index order, each signing its place in
 * the group. The final segment also signs the count, the digest of the
 * segments before it, and the author's processed cursor, so it is encrypted
 * last: the digest covers the earlier segments' metadata and ciphertext
 * hashes, which exist only once they are encrypted.
 */
export async function encryptRotationBaselineGroup(input: {
  readonly baselineId: string;
  /** The epoch's key, opened for this document and `contentKeyEpoch`. */
  readonly contentKey: DocumentContentKey;
  readonly contentKeyEpoch: number;
  readonly coversThroughUpdateId?: string | undefined;
  readonly documentId: string;
  readonly organizationId: string;
  readonly segments: readonly PendingUpdateRecord[];
}): Promise<DocumentSyncPreparedUpdate[]> {
  const digestEntries: DocumentBaselineSegmentDigestEntry[] = [];
  const prepared: DocumentSyncPreparedUpdate[] = [];
  for (const [index, segment] of input.segments.entries()) {
    const baseline: DocumentBaselineSegmentFields = {
      baselineId: input.baselineId,
      baselineSegmentIndex: index,
      ...(index < input.segments.length - 1
        ? {}
        : {
            baselineSegmentCount: input.segments.length,
            baselineSegmentsDigest: await computeDocumentBaselineSegmentsDigest(
              {
                baselineId: input.baselineId,
                documentId: input.documentId,
                segments: digestEntries,
              },
            ),
            ...(input.coversThroughUpdateId === undefined
              ? {}
              : { coversThroughUpdateId: input.coversThroughUpdateId }),
          }),
    };
    const encrypted = await encryptDocumentPendingUpdate({
      baseline,
      contentKey: input.contentKey,
      contentKeyEpoch: input.contentKeyEpoch,
      documentId: input.documentId,
      organizationId: input.organizationId,
      update: segment,
    });
    digestEntries.push({
      ciphertextHash: encrypted.ciphertextHash,
      metadataHash: encrypted.metadataHash,
      updateId: segment.id,
    });
    prepared.push({
      ...baseline,
      ciphertextHash: encrypted.ciphertextHash,
      contentRecordId: encrypted.contentRecordId,
      dependencyVersionVector: encrypted.dependencyVersionVector,
      encryptedData: encrypted.encryptedData,
      id: segment.id,
      metadataHash: encrypted.metadataHash,
      partialEndVersionVector: segment.partialEndVersionVector,
      partialStartVersionVector: segment.partialStartVersionVector,
      plaintextHash: encrypted.plaintextHash,
    });
  }
  return prepared;
}

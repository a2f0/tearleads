// A rotation baseline group built whole in memory, for tests of what a
// reader or a request does with one. The writer itself cuts and encrypts a
// segment at a time (`workflows/documents/baselineStage`); these helpers
// take any segments, honest or not, and sign their places in a group.
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
  type HistorySegmentSizes,
  importSnapshot,
  versionVectorsEqual,
} from "@tearleads/loro";
import { encryptDocumentPendingUpdate } from "../../../src/data/documents/shared/crypto";
import type { DocumentBaselineSegmentFields } from "../../../src/data/documents/shared/sync/baselineSegment";
import type { DocumentContentKey } from "../../../src/data/documents/shared/sync/contentKeyCommitment";
import type { DocumentSyncPreparedUpdate } from "../../../src/data/documents/shared/sync/documentSyncTypes";
import type { PendingUpdateRecord } from "../../../src/data/persistence/documents/records";

/** A proven history cut into the segments of one rotation baseline. */
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

/** Cut the history in a full-history `snapshot` into a baseline's segments. */
export function segmentRotationSnapshot(input: {
  readonly purpose: string;
  readonly segmentSizes?: HistorySegmentSizes | undefined;
  readonly snapshot: Uint8Array;
}): DocumentRotationBaselineHistory {
  const metadata = getImportBlobMetadata(input.snapshot);
  if (
    metadata.mode !== "snapshot" ||
    !versionVectorsEqual(
      metadata.partialStartVersionVector,
      emptyVersionVector(),
    )
  ) {
    throw new Error(
      `${input.purpose} requires a full-history rotation snapshot`,
    );
  }
  const document = createReadOnlyDocument();
  const segments: PendingUpdateRecord[] = [];
  try {
    importSnapshot(document, input.snapshot);
    for (const segment of exportHistorySegments(document, input.segmentSizes)) {
      segments.push({
        id: crypto.randomUUID(),
        partialEndVersionVector: segment.partialEndVersionVector,
        partialStartVersionVector: segment.partialStartVersionVector,
        updateData: bytesToBase64(segment.update),
      });
    }
  } finally {
    document.free();
  }
  return {
    baselineId: crypto.randomUUID(),
    segments,
    version: metadata.partialEndVersionVector,
  };
}

/** The one segment of an empty baseline: an update with no operations. */
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
 * segments before it, and the author's processed cursor.
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

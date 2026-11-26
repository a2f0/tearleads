import type { HistorySegmentSizes } from "@tearleads/loro";
import type { DocumentOutgoingUpdate } from "@tearleads/validators/request";
import type {
  DocumentSyncResponse,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import { targetEnvelopeReference } from "../../../src/data/documents/shared/readers";
import { documentBaselineSegmentFields } from "../../../src/data/documents/shared/sync/baselineSegment";
import type { DocumentCreateAuthor } from "../../../src/data/documents/shared/types";

type ServedUpdate = DocumentSyncResponse["updates"][number];

/** Segment sizes small enough that a short test history takes several. */
export const SMALL_BASELINE_SEGMENTS: HistorySegmentSizes = {
  maxBytes: 1024,
  targetBytes: 256,
};

/** A signed outgoing update as the server would serve it back. */
export function servedUpdateFromOutgoing(input: {
  readonly author: DocumentCreateAuthor;
  readonly documentId: string;
  readonly update: DocumentOutgoingUpdate;
  readonly writerProjection: DocumentWriterProjectionResponse;
}): ServedUpdate {
  const { update } = input;
  return {
    accessEpoch: 1,
    authorizationTargets: input.writerProjection.contentKeyBundle.targets.map(
      targetEnvelopeReference,
    ),
    ...documentBaselineSegmentFields(update),
    authorFingerprint: input.author.signerKeyFingerprint,
    createdAt: "2026-04-27T00:00:00.000Z",
    dependencyVersionVector: update.dependencyVersionVector,
    documentId: input.documentId,
    encryptedData: update.encryptedData,
    id: update.id,
    partialEndVersionVector: update.partialEndVersionVector,
    partialStartVersionVector: update.partialStartVersionVector,
    plaintextHash: update.plaintextHash,
    writeHeader: update.writeHeader,
  };
}

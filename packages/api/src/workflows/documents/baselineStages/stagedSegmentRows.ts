import { Buffer } from "node:buffer";
import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import {
  documentBaselineSegmentSpans,
  documentBaselineSegments,
  documentContentWriteHeaders,
} from "@tearleads/api-shared/schema";
import type { VerifiedWriteHeader, WriteHeader } from "@tearleads/crypto";
import type { DocumentOutgoingUpdate } from "@tearleads/validators/request";
import {
  MAX_DOCUMENT_BASELINE_STAGE_BYTES,
  MAX_DOCUMENT_BASELINE_STAGE_SPANS,
} from "@tearleads/validators/util";
import { and, eq, or } from "drizzle-orm";
import type { BaselineSegmentHistory } from "../../../documents/documentBaselineGroup";
import type { DocumentBaselineStageRow } from "../../../documents/documentBaselineStageState";
import { chunkDocumentPeerRows } from "../../../documents/documentPeerRowChunks";
import { writeHeaderAuthorizationHash } from "../../../documents/writeHeaderAuthorizationHash";
import { documentBaselineStageTooLarge, stagedSegmentConflict } from "./errors";

/** What staging one segment adds to its stage's counts. */
interface StagedSegmentSize {
  readonly bytes: number;
  readonly spans: number;
}

function utf8Bytes(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

/**
 * Hold the segment to what one stage may store, before anything is written.
 * Its bytes are everything the staged row keeps of it: the ciphertext, the
 * three signed vectors, the plaintext hash and the write header, so a
 * segment of small ciphertext and wide vectors counts for what it costs.
 * Its spans are the rows its vectors declare, one per peer it carries, which
 * a commit copies under the document head lock.
 */
export function assertSegmentFitsStage(
  stage: Pick<DocumentBaselineStageRow, "stagedBytes" | "stagedSpans">,
  input: {
    readonly header: WriteHeader;
    readonly history: BaselineSegmentHistory;
    readonly segment: DocumentOutgoingUpdate;
  },
): StagedSegmentSize {
  const { segment } = input;
  const bytes =
    utf8Bytes(segment.encryptedData) +
    utf8Bytes(segment.partialStartVersionVector) +
    utf8Bytes(segment.partialEndVersionVector) +
    utf8Bytes(segment.dependencyVersionVector) +
    utf8Bytes(segment.plaintextHash) +
    utf8Bytes(JSON.stringify(input.header));
  const spans = input.history.spans.length;
  if (stage.stagedBytes + bytes > MAX_DOCUMENT_BASELINE_STAGE_BYTES) {
    throw documentBaselineStageTooLarge("byte cap");
  }
  if (stage.stagedSpans + spans > MAX_DOCUMENT_BASELINE_STAGE_SPANS) {
    throw documentBaselineStageTooLarge("span cap");
  }
  return { bytes, spans };
}

/**
 * A content record, and the nonce domain derived from it, belongs to one
 * update of a document's epoch: the committed write headers keep both
 * unique. A staged segment that reused one, another staged segment's or a
 * committed update's, could never commit, and its stage with it, so it is
 * refused here, while the writer can still sign it again under its own.
 */
export async function assertContentRecordUnused(
  executor: DatabaseTransaction,
  stage: DocumentBaselineStageRow,
  header: Pick<WriteHeader, "contentRecordId" | "nonceDomainHash">,
): Promise<void> {
  const [staged] = await executor
    .select({ updateId: documentBaselineSegments.updateId })
    .from(documentBaselineSegments)
    .where(
      and(
        eq(documentBaselineSegments.documentId, stage.documentId),
        eq(documentBaselineSegments.baselineId, stage.id),
        or(
          eq(documentBaselineSegments.contentRecordId, header.contentRecordId),
          eq(documentBaselineSegments.nonceDomainHash, header.nonceDomainHash),
        ),
      ),
    )
    .limit(1);
  if (staged) throw stagedSegmentConflict();
  const [committed] = await executor
    .select({ updateId: documentContentWriteHeaders.updateId })
    .from(documentContentWriteHeaders)
    .where(
      and(
        eq(documentContentWriteHeaders.documentId, stage.documentId),
        eq(documentContentWriteHeaders.contentKeyEpoch, stage.contentKeyEpoch),
        or(
          eq(
            documentContentWriteHeaders.contentRecordId,
            header.contentRecordId,
          ),
          eq(
            documentContentWriteHeaders.nonceDomainHash,
            header.nonceDomainHash,
          ),
        ),
      ),
    )
    .limit(1);
  if (committed) throw stagedSegmentConflict();
}

/** Store a verified segment and its spans under its stage. */
export async function insertStagedSegment(
  executor: DatabaseTransaction,
  input: {
    readonly history: BaselineSegmentHistory;
    readonly segment: DocumentOutgoingUpdate;
    readonly segmentIndex: number;
    readonly stage: DocumentBaselineStageRow;
    readonly verified: VerifiedWriteHeader;
  },
): Promise<void> {
  const { segment, stage } = input;
  const { header } = input.verified;
  await executor.insert(documentBaselineSegments).values({
    authorizationHash: writeHeaderAuthorizationHash(header),
    baselineId: stage.id,
    byteLength: utf8Bytes(segment.encryptedData),
    contentRecordId: header.contentRecordId,
    dependencyVersionVector: segment.dependencyVersionVector,
    documentId: stage.documentId,
    encryptedData: segment.encryptedData,
    header,
    headerHash: input.verified.headerHash,
    nonceDomainHash: header.nonceDomainHash,
    partialEndVersionVector: segment.partialEndVersionVector,
    partialStartVersionVector: segment.partialStartVersionVector,
    plaintextHash: segment.plaintextHash,
    segmentIndex: input.segmentIndex,
    updateId: segment.id,
  });
  const spanRows = input.history.spans.map((span) => ({
    baselineId: stage.id,
    documentId: stage.documentId,
    endCounter: span.endCounter,
    peerId: span.peerId,
    startCounter: span.startCounter,
    updateId: segment.id,
  }));
  for (const chunk of chunkDocumentPeerRows(spanRows)) {
    await executor.insert(documentBaselineSegmentSpans).values(chunk);
  }
}

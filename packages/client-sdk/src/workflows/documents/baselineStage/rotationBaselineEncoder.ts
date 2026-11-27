import {
  extendDocumentBaselineSegmentsDigest,
  startDocumentBaselineSegmentsDigest,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  createReadOnlyDocument,
  DEFAULT_HISTORY_SEGMENT_MAX_BYTES,
  DEFAULT_HISTORY_SEGMENT_TARGET_BYTES,
  emptyVersionVector,
  exportAllUpdates,
  getImportBlobMetadata,
  type HistorySegment,
  HistorySegmentCounterTooLargeError,
  type HistorySegmentSizes,
  mergeVersionVectors,
} from "@tearleads/loro";
import {
  computeDocumentUpdatePlaintextHash,
  encryptDocumentPendingUpdate,
} from "../../../data/documents/shared/crypto";
import type { DocumentBaselineSegmentFields } from "../../../data/documents/shared/sync/baselineSegment";
import type { DocumentContentKey } from "../../../data/documents/shared/sync/contentKeyCommitment";
import { DocumentSyncRequestLimitError } from "../../../data/documents/shared/sync/documentSyncOutgoingBatch";
import type { DocumentSyncPreparedUpdate } from "../../../data/documents/shared/sync/documentSyncTypes";
import type { PendingUpdateRecord } from "../../../data/persistence/documents/records";
import type { RotationHistory } from "./rotationHistory";
import type { StagedSegmentRecord } from "./stagedBaselineUploads";

const MEBIBYTE = 1024 * 1024;

/**
 * The plaintext a staged baseline's final segment aims for. That segment
 * travels in the request that rotates, beside everything else it carries,
 * so the writer cuts the end of the history small.
 */
export const ROTATION_BASELINE_FINAL_SEGMENT_TARGET_BYTES = MEBIBYTE;

/** The key and the names a baseline's segments are encrypted under. */
export interface RotationBaselineKeying {
  /** The epoch's key, opened for this document and `contentKeyEpoch`. */
  readonly contentKey: DocumentContentKey;
  readonly contentKeyEpoch: number;
  readonly documentId: string;
  readonly organizationId: string;
}

/** One encrypted segment, and what staging it would record. */
export interface EncodedBaselineSegment {
  /** The stage's digest once this segment is staged; unset on the final. */
  readonly digestAfter: string | undefined;
  readonly final: boolean;
  readonly prepared: DocumentSyncPreparedUpdate;
}

/** What the writer keeps of `segment` once it is staged. */
export function stagedSegmentRecord(
  segment: EncodedBaselineSegment,
): StagedSegmentRecord {
  const { prepared } = segment;
  if (segment.digestAfter === undefined) {
    throw new Error("A baseline's final segment is never staged");
  }
  return {
    ciphertextHash: prepared.ciphertextHash,
    contentRecordId: prepared.contentRecordId ?? prepared.id,
    dependencyVersionVector: prepared.dependencyVersionVector,
    digestAfter: segment.digestAfter,
    metadataHash: prepared.metadataHash,
    partialEndVersionVector: prepared.partialEndVersionVector,
    partialStartVersionVector: prepared.partialStartVersionVector,
    plaintextHash: prepared.plaintextHash,
    updateId: prepared.id,
  };
}

async function encryptBaselineSegment(
  keying: RotationBaselineKeying,
  baseline: DocumentBaselineSegmentFields,
  update: PendingUpdateRecord,
): Promise<DocumentSyncPreparedUpdate> {
  const encrypted = await encryptDocumentPendingUpdate({
    ...keying,
    baseline,
    update,
  });
  return {
    ...baseline,
    ciphertextHash: encrypted.ciphertextHash,
    contentRecordId: encrypted.contentRecordId,
    dependencyVersionVector: encrypted.dependencyVersionVector,
    encryptedData: encrypted.encryptedData,
    id: update.id,
    metadataHash: encrypted.metadataHash,
    partialEndVersionVector: update.partialEndVersionVector,
    partialStartVersionVector: update.partialStartVersionVector,
    plaintextHash: encrypted.plaintextHash,
  };
}

/**
 * The whole of an empty baseline: one segment with no operations that signs
 * its author's processed cursor. The author voided every update through the
 * cursor, so the history is empty, and the API asks the baseline to cover
 * only the updates after it.
 */
export async function encodeEmptyRotationBaseline(input: {
  readonly coversThroughUpdateId: string;
  readonly keying: RotationBaselineKeying;
}): Promise<DocumentSyncPreparedUpdate> {
  const baselineId = crypto.randomUUID();
  const document = createReadOnlyDocument();
  try {
    const update = exportAllUpdates(document);
    const vectors = getImportBlobMetadata(update);
    return await encryptBaselineSegment(
      input.keying,
      {
        baselineId,
        baselineSegmentCount: 1,
        baselineSegmentIndex: 0,
        baselineSegmentsDigest: await startDocumentBaselineSegmentsDigest({
          baselineId,
          documentId: input.keying.documentId,
        }),
        coversThroughUpdateId: input.coversThroughUpdateId,
      },
      {
        id: crypto.randomUUID(),
        partialEndVersionVector: vectors.partialEndVersionVector,
        partialStartVersionVector: vectors.partialStartVersionVector,
        updateData: bytesToBase64(update),
      },
    );
  } finally {
    document.free();
  }
}

interface EncoderStart {
  /** The version the staged segments reach; absent for a new baseline. */
  readonly after?: string | undefined;
  readonly baselineId: string;
  /** The author's processed cursor, which the final segment signs. */
  readonly coversThroughUpdateId: string | undefined;
  /** The digest of the segments before `index`. */
  readonly digest: string;
  readonly history: RotationHistory;
  /** The index of the first segment this encoder produces. */
  readonly index: number;
  readonly keying: RotationBaselineKeying;
  readonly segmentSizes: HistorySegmentSizes | undefined;
}

/**
 * Cuts a history into a baseline's segments and encrypts them one at a
 * time, in index order, each signing its place in the group. The history is
 * exported a segment ahead, so the encoder knows which one is the final:
 * that one also signs the count, the digest of the segments before it, and
 * the cursor. A caller that hands each segment on holds two of them, never
 * the baseline.
 */
export class RotationBaselineEncoder {
  private digest: string;
  private index: number;
  private reached: string;
  private segments: Generator<HistorySegment, void, undefined>;
  /** The segments exported ahead of the one being encrypted, at most two. */
  private readonly window: HistorySegment[] = [];
  private spent = false;
  private finalCutSmall = false;

  constructor(private readonly start: EncoderStart) {
    this.digest = start.digest;
    this.index = start.index;
    this.reached = start.after ?? emptyVersionVector();
    this.segments = start.history.segments(this.sizes(), start.after);
  }

  /**
   * The caller's sizes, within the most plaintext one segment may hold
   * (`DEFAULT_HISTORY_SEGMENT_MAX_BYTES`): a segment is one update, and an
   * update travels in a request of at most 16 MiB, staged or sent whole. A
   * caller can cut smaller and never larger.
   */
  private sizes(): Required<HistorySegmentSizes> {
    const { maxBytes, targetBytes } = this.start.segmentSizes ?? {};
    const cap = DEFAULT_HISTORY_SEGMENT_MAX_BYTES;
    return {
      maxBytes: Math.min(maxBytes ?? cap, cap),
      targetBytes: Math.min(
        targetBytes ?? DEFAULT_HISTORY_SEGMENT_TARGET_BYTES,
        cap,
      ),
    };
  }

  /**
   * Export until `count` segments wait, or the history is spent. One
   * operation over the cap is its author's data, which no retry shrinks.
   */
  private fill(count: number): void {
    while (!this.spent && this.window.length < count) {
      try {
        const next = this.segments.next();
        if (next.done) this.spent = true;
        else this.window.push(next.value);
      } catch (error) {
        if (error instanceof HistorySegmentCounterTooLargeError) {
          throw new DocumentSyncRequestLimitError(
            `Document rotation baseline cannot carry one operation: ${error.message}`,
          );
        }
        throw error;
      }
    }
  }

  /** The next segment's plaintext size and whether it is the last one. */
  peek(): { readonly bytes: number; readonly final: boolean } | null {
    this.fill(2);
    const next = this.window[0];
    return next
      ? { bytes: next.update.byteLength, final: this.window.length === 1 }
      : null;
  }

  /**
   * Cut the last segment again, small, so that the final one is: the end of
   * the history then travels in the rotating request without crowding it.
   * Done once, for a staged baseline, when the last segment came out large.
   */
  private cutFinalSmall(): void {
    const [last] = this.window;
    const sizes = this.sizes();
    const usual = sizes.targetBytes;
    const targetBytes = Math.min(
      ROTATION_BASELINE_FINAL_SEGMENT_TARGET_BYTES,
      usual,
    );
    if (
      this.finalCutSmall ||
      !last ||
      targetBytes >= usual ||
      last.update.byteLength <= targetBytes
    ) {
      return;
    }
    this.finalCutSmall = true;
    this.segments = this.start.history.segments(
      { ...sizes, targetBytes },
      this.reached,
    );
    this.window.length = 0;
    this.spent = false;
  }

  /**
   * Encrypt the next segment, or null when the history is spent. With
   * `smallFinal`, a large last segment is first cut again so that the final
   * one is small.
   */
  async next(options: {
    readonly smallFinal: boolean;
  }): Promise<EncodedBaselineSegment | null> {
    this.fill(2);
    if (options.smallFinal && this.window.length === 1) this.cutFinalSmall();
    this.fill(2);
    const segment = this.window.shift();
    if (!segment) return null;
    const final = this.window.length === 0;
    const { baselineId, coversThroughUpdateId, keying } = this.start;
    const index = this.index;
    const prepared = await encryptBaselineSegment(
      keying,
      {
        baselineId,
        baselineSegmentIndex: index,
        ...(final
          ? {
              baselineSegmentCount: index + 1,
              baselineSegmentsDigest: this.digest,
              ...(coversThroughUpdateId === undefined
                ? {}
                : { coversThroughUpdateId }),
            }
          : {}),
      },
      {
        id: crypto.randomUUID(),
        partialEndVersionVector: segment.partialEndVersionVector,
        partialStartVersionVector: segment.partialStartVersionVector,
        updateData: bytesToBase64(segment.update),
      },
    );
    this.index += 1;
    this.reached = mergeVersionVectors([
      this.reached,
      segment.partialEndVersionVector,
    ]);
    if (final) return { digestAfter: undefined, final, prepared };
    this.digest = await extendDocumentBaselineSegmentsDigest(this.digest, {
      ciphertextHash: prepared.ciphertextHash,
      metadataHash: prepared.metadataHash,
      segmentIndex: index,
      updateId: prepared.id,
    });
    return { digestAfter: this.digest, final, prepared };
  }
}

/** The encoder of a new baseline over the whole of `history`. */
export async function startRotationBaselineEncoder(
  input: Omit<EncoderStart, "after" | "baselineId" | "digest" | "index">,
): Promise<{ baselineId: string; encoder: RotationBaselineEncoder }> {
  const baselineId = crypto.randomUUID();
  const digest = await startDocumentBaselineSegmentsDigest({
    baselineId,
    documentId: input.keying.documentId,
  });
  return {
    baselineId,
    encoder: new RotationBaselineEncoder({
      ...input,
      baselineId,
      digest,
      index: 0,
    }),
  };
}

/**
 * The encoder that continues a staged baseline: its segments carry what
 * `history` holds past the staged ones, from the index after them.
 */
export async function continueRotationBaselineEncoder(
  input: Omit<EncoderStart, "after" | "digest" | "index"> & {
    readonly staged: readonly StagedSegmentRecord[];
  },
): Promise<RotationBaselineEncoder> {
  const { staged, ...start } = input;
  return new RotationBaselineEncoder({
    ...start,
    after: mergeVersionVectors(
      staged.map((record) => record.partialEndVersionVector),
    ),
    digest:
      staged.at(-1)?.digestAfter ??
      (await startDocumentBaselineSegmentsDigest({
        baselineId: input.baselineId,
        documentId: input.keying.documentId,
      })),
    index: staged.length,
  });
}

/**
 * Whether `history` still gives the bytes a staged segment was encrypted
 * from: the recorded range exports again, and its keyed hash is the one the
 * segment's metadata signs. A history that left the range out, or that
 * encodes it otherwise, does not, and the staged segment is then no part of
 * what the writer can prove.
 */
export async function stagedSegmentMatchesHistory(input: {
  readonly history: RotationHistory;
  readonly keying: RotationBaselineKeying;
  readonly record: StagedSegmentRecord;
}): Promise<boolean> {
  const { keying, record } = input;
  const plaintext = input.history.segmentRange(record);
  if (!plaintext) return false;
  const plaintextHash = await computeDocumentUpdatePlaintextHash({
    contentKeyEpoch: keying.contentKeyEpoch,
    contentKeyMaterial: keying.contentKey.material,
    contentRecordId: record.contentRecordId,
    documentId: keying.documentId,
    organizationId: keying.organizationId,
    plaintext,
  });
  return plaintextHash === record.plaintextHash;
}

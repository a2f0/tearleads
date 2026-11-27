import { z } from "zod";
import {
  arraySchema,
  boundedNonNegativeIntegerSchema,
  loosePlainObject,
  positiveIntegerSchema,
  safeNonNegativeIntegerSchema,
  sha256HexStringSchema,
  uuidV4StringSchema,
} from "../schema";
import {
  MAX_DOCUMENT_STAGED_BASELINE_SEGMENTS,
  MAX_OPEN_DOCUMENT_BASELINE_STAGES_PER_USER,
} from "../util/documentSyncLimits";

/**
 * Why a staged rotation baseline was refused. A stage holds every segment of
 * a baseline but the final one, uploaded ahead of the request that rotates.
 * Each code tells the writer what its stage is worth now:
 *
 * - `not_found` and `expired` are positive proof the stage is gone, so the
 *   writer opens a new one and uploads again. An uncoded failure proves
 *   nothing, and the writer keeps its stage.
 * - `epoch_stale`: the document's content key moved past the epoch the stage
 *   was opened for, or the stage names another key for that epoch. No
 *   request can commit it; the writer abandons it and plans again.
 * - `headers_stale`: the staged segments' write headers were signed for
 *   another manifest, key-target set or writer key than the final segment.
 *   The ciphertext is still good: the writer signs the headers again and
 *   sends only those.
 * - `segment_out_of_order`: the segment's index is not the stage's next. The
 *   response names the next index, so the writer resumes from there.
 * - `segment_conflict`: the index or the update id is taken by other bytes.
 * - `segment_invalid`: the segment is not one a baseline holds at that
 *   place. No honest writer sends one.
 * - `id_conflict`: the baseline id is another user's open stage on this
 *   document, or a baseline the document committed already.
 * - `limit_reached`: the caller already holds as many open stages as one
 *   user may. The response names them (`openStages`), so a writer that lost
 *   track of one can abandon it, or wait for one to commit or expire.
 * - `too_large`: the segment would take the stage past what one stage may
 *   store, in bytes or in span rows. The stage is unchanged; this history
 *   cannot be staged whole.
 */
export const DOCUMENT_BASELINE_STAGE_ERROR_CODES = {
  epochStale: "document_baseline_stage_epoch_stale",
  expired: "document_baseline_stage_expired",
  headersStale: "document_baseline_stage_headers_stale",
  idConflict: "document_baseline_stage_id_conflict",
  limitReached: "document_baseline_stage_limit_reached",
  notFound: "document_baseline_stage_not_found",
  segmentConflict: "document_baseline_stage_segment_conflict",
  segmentInvalid: "document_baseline_stage_segment_invalid",
  segmentOutOfOrder: "document_baseline_stage_segment_out_of_order",
  tooLarge: "document_baseline_stage_too_large",
} as const;

export const DocumentBaselineStageErrorCodeSchema = z.literal([
  DOCUMENT_BASELINE_STAGE_ERROR_CODES.epochStale,
  DOCUMENT_BASELINE_STAGE_ERROR_CODES.expired,
  DOCUMENT_BASELINE_STAGE_ERROR_CODES.headersStale,
  DOCUMENT_BASELINE_STAGE_ERROR_CODES.idConflict,
  DOCUMENT_BASELINE_STAGE_ERROR_CODES.limitReached,
  DOCUMENT_BASELINE_STAGE_ERROR_CODES.notFound,
  DOCUMENT_BASELINE_STAGE_ERROR_CODES.segmentConflict,
  DOCUMENT_BASELINE_STAGE_ERROR_CODES.segmentInvalid,
  DOCUMENT_BASELINE_STAGE_ERROR_CODES.segmentOutOfOrder,
  DOCUMENT_BASELINE_STAGE_ERROR_CODES.tooLarge,
]);

export type DocumentBaselineStageErrorCode = z.infer<
  typeof DocumentBaselineStageErrorCodeSchema
>;

export function isDocumentBaselineStageErrorCode(
  value: unknown,
): value is DocumentBaselineStageErrorCode {
  return DocumentBaselineStageErrorCodeSchema.safeParse(value).success;
}

const nextSegmentIndexSchema = boundedNonNegativeIntegerSchema(
  MAX_DOCUMENT_STAGED_BASELINE_SEGMENTS - 1,
);

export const DocumentBaselineStageStatusResponseSchema = loosePlainObject({
  baselineId: uuidV4StringSchema,
  contentKeyCommitment: sha256HexStringSchema,
  contentKeyEpoch: positiveIntegerSchema,
  expiresAt: z.string().min(1),
  nextSegmentIndex: nextSegmentIndexSchema,
  segmentsDigest: sha256HexStringSchema,
  stagedBytes: safeNonNegativeIntegerSchema,
});

export type DocumentBaselineStageStatusResponse = z.infer<
  typeof DocumentBaselineStageStatusResponseSchema
>;

export function isDocumentBaselineStageStatusResponse(
  value: unknown,
): value is DocumentBaselineStageStatusResponse {
  return DocumentBaselineStageStatusResponseSchema.safeParse(value).success;
}

export const DocumentBaselineStageAbandonResponseSchema = loosePlainObject({
  baselineId: uuidV4StringSchema,
});

export type DocumentBaselineStageAbandonResponse = z.infer<
  typeof DocumentBaselineStageAbandonResponseSchema
>;

export function isDocumentBaselineStageAbandonResponse(
  value: unknown,
): value is DocumentBaselineStageAbandonResponse {
  return DocumentBaselineStageAbandonResponseSchema.safeParse(value).success;
}

/**
 * The stage is gone, or was never the caller's on this document. Only this
 * coded 404 proves that: a proxy or route 404 stays uncoded.
 */
export const DocumentBaselineStageNotFoundErrorResponseSchema = z.looseObject({
  code: z.literal(DOCUMENT_BASELINE_STAGE_ERROR_CODES.notFound),
  error: z.string().min(1),
});

export type DocumentBaselineStageNotFoundErrorResponse = z.infer<
  typeof DocumentBaselineStageNotFoundErrorResponseSchema
>;

/**
 * The codes a stage route's 409 carries: every stage code but the 404's
 * `not_found` and `headers_stale`, which only a commit can find.
 */
const DocumentBaselineStageConflictCodeSchema = z.literal([
  DOCUMENT_BASELINE_STAGE_ERROR_CODES.epochStale,
  DOCUMENT_BASELINE_STAGE_ERROR_CODES.expired,
  DOCUMENT_BASELINE_STAGE_ERROR_CODES.idConflict,
  DOCUMENT_BASELINE_STAGE_ERROR_CODES.limitReached,
  DOCUMENT_BASELINE_STAGE_ERROR_CODES.segmentConflict,
  DOCUMENT_BASELINE_STAGE_ERROR_CODES.segmentInvalid,
  DOCUMENT_BASELINE_STAGE_ERROR_CODES.segmentOutOfOrder,
  DOCUMENT_BASELINE_STAGE_ERROR_CODES.tooLarge,
]);

export type DocumentBaselineStageConflictCode = z.infer<
  typeof DocumentBaselineStageConflictCodeSchema
>;

/** One of the caller's open stages, as a `limit_reached` refusal names it. */
const DocumentBaselineOpenStageSchema = z.looseObject({
  baselineId: uuidV4StringSchema,
  documentId: z.string().min(1),
  expiresAt: z.string().min(1),
});

/**
 * A refused stage request. An uncoded conflict is a failed access or billing
 * check, or a write that raced another, and leaves the stage as it was.
 */
export const DocumentBaselineStageConflictErrorResponseSchema = z.looseObject({
  code: DocumentBaselineStageConflictCodeSchema.optional(),
  error: z.string().min(1),
  nextSegmentIndex: nextSegmentIndexSchema.optional(),
  openStages: arraySchema(
    DocumentBaselineOpenStageSchema,
    MAX_OPEN_DOCUMENT_BASELINE_STAGES_PER_USER,
  ).optional(),
});

export type DocumentBaselineStageConflictErrorResponse = z.infer<
  typeof DocumentBaselineStageConflictErrorResponseSchema
>;

export function isDocumentBaselineStageConflictErrorResponse(
  value: unknown,
): value is DocumentBaselineStageConflictErrorResponse {
  return DocumentBaselineStageConflictErrorResponseSchema.safeParse(value)
    .success;
}

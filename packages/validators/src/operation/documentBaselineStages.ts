import { z } from "zod";
import { documentSyncRequestRotationRefinement } from "../documentSyncRefinements";
import { registerJsonSchemaFragment } from "../jsonSchema";
import {
  DocumentBaselineStageOpenRequestSchema,
  DocumentBaselineStageWriteHeaderRequestSchema,
  isDocumentBaselineStageOpenRequest,
  isDocumentBaselineStageWriteHeaderRequest,
} from "../request/documentBaselineStage";
import { DocumentSyncOutgoingUpdateSchema } from "../request/documentSyncSchema";
import { SessionFailureResponseSchema } from "../response/auth/sessionFailure";
import {
  DocumentBaselineStageAbandonResponseSchema,
  DocumentBaselineStageConflictErrorResponseSchema,
  DocumentBaselineStageNotFoundErrorResponseSchema,
  DocumentBaselineStageStatusResponseSchema,
  isDocumentBaselineStageAbandonResponse,
  isDocumentBaselineStageStatusResponse,
} from "../response/documentBaselineStage";
import { ErrorResponseSchema } from "../response/error";
import { PaymentRequiredErrorResponseSchema } from "../response/organizationBilling";
import { uuidV4StringSchema } from "../schema";
import {
  DOCUMENT_BASELINE_STAGE_BUSY_RETRY_AFTER_SECONDS,
  DOCUMENT_BASELINE_STAGE_IDLE_SECONDS,
  DOCUMENT_BASELINE_STAGE_MAX_SECONDS,
  MAX_DOCUMENT_BASELINE_SEGMENT_HEADER_REQUEST_BYTES,
  MAX_DOCUMENT_BASELINE_SEGMENT_REQUEST_BYTES,
  MAX_DOCUMENT_STAGED_BASELINE_SEGMENTS,
  MAX_OPEN_DOCUMENT_BASELINE_STAGES_PER_USER,
} from "../util/documentSyncLimits";
import { defineJsonOperation } from "./definition";

// A stage route names its document and baseline by their canonical ids:
// lower-case, as every signed artifact spells them. The baseline digest and
// each segment's signed metadata are rooted in those strings, so an id the
// path spelled another way would name a group no reader can reproduce. The
// API refuses one here, before any route reads it.
const CANONICAL_UUID_PATTERN =
  "^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$";

const canonicalUuidSchema = registerJsonSchemaFragment(
  z.string().regex(new RegExp(CANONICAL_UUID_PATTERN, "u")),
  { pattern: CANONICAL_UUID_PATTERN, type: "string" },
);

export const DocumentBaselineStagesPathParamsSchema = z.strictObject({
  documentId: canonicalUuidSchema,
});

export const DocumentBaselineStagePathParamsSchema = z.strictObject({
  baselineId: uuidV4StringSchema,
  documentId: canonicalUuidSchema,
});

// Every segment but the final one is staged, so the highest staged index is
// two below the cap.
const MAX_STAGED_SEGMENT_INDEX = MAX_DOCUMENT_STAGED_BASELINE_SEGMENTS - 2;

/** A staged segment's index, which a path carries as decimal digits. */
const stagedSegmentIndexSchema = registerJsonSchemaFragment(
  z.custom<number | string>((value) => {
    if (typeof value === "number") {
      return (
        Number.isInteger(value) &&
        value >= 0 &&
        value <= MAX_STAGED_SEGMENT_INDEX
      );
    }
    if (typeof value !== "string" || !/^(?:0|[1-9]\d{0,3})$/u.test(value)) {
      return false;
    }
    return Number(value) <= MAX_STAGED_SEGMENT_INDEX;
  }),
  { maximum: MAX_STAGED_SEGMENT_INDEX, minimum: 0, type: "integer" },
);

export const DocumentBaselineStageSegmentPathParamsSchema = z.strictObject({
  baselineId: uuidV4StringSchema,
  documentId: canonicalUuidSchema,
  segmentIndex: stagedSegmentIndexSchema,
});

export type DocumentBaselineStagePathParams = z.infer<
  typeof DocumentBaselineStagePathParamsSchema
>;
export type DocumentBaselineStageSegmentPathParams = z.infer<
  typeof DocumentBaselineStageSegmentPathParamsSchema
>;

const stageFailureResponses = {
  400: ErrorResponseSchema,
  401: SessionFailureResponseSchema,
  402: PaymentRequiredErrorResponseSchema,
  403: ErrorResponseSchema,
  404: DocumentBaselineStageNotFoundErrorResponseSchema,
  409: DocumentBaselineStageConflictErrorResponseSchema,
  500: ErrorResponseSchema,
} as const;

const stageFailureStatuses = [400, 401, 402, 403, 404, 409, 500] as const;

/**
 * What an open's 503 carries. The header is optional because every route's
 * 503 is also the outer boundary's answer to a database it could not
 * reach, which names no delay.
 */
const DocumentBaselineStageBusyHeadersSchema = z.strictObject({
  "retry-after": z
    .literal(String(DOCUMENT_BASELINE_STAGE_BUSY_RETRY_AFTER_SECONDS))
    .optional(),
});

const IDLE_MINUTES = DOCUMENT_BASELINE_STAGE_IDLE_SECONDS / 60;
const MAX_HOURS = DOCUMENT_BASELINE_STAGE_MAX_SECONDS / (60 * 60);

export const openDocumentBaselineStageOperation = defineJsonOperation({
  auth: "session",
  body: DocumentBaselineStageOpenRequestSchema,
  failureResponses: { ...stageFailureResponses, 503: ErrorResponseSchema },
  failureStatuses: [...stageFailureStatuses, 503],
  id: "documents.baselineStages.open",
  summary: "Open a rotation baseline stage",
  description: `Opens the stage a writer uploads a rotation baseline's segments to ahead of the unlink or sync that rotates, for a history too large for one request. Requires write access to the document, as every later stage request does, and replaces the caller's earlier stage for it; a user holds at most ${MAX_OPEN_DOCUMENT_BASELINE_STAGES_PER_USER} open stages, and one more returns 409 \`document_baseline_stage_limit_reached\`. The stage expires ${IDLE_MINUTES} minutes after its last upload and at most ${MAX_HOURS} hours after it opened; nothing staged is served until a rotating request commits it. An open does not wait for the caller's own stage on the document: while another of the caller's requests holds it (a segment being staged, a header being re-signed, a commit) the open returns 503 with \`Retry-After\` and changes nothing, so a writer lets its other requests to that stage finish before it opens again.`,
  method: "POST",
  params: DocumentBaselineStagesPathParamsSchema,
  path: "/documents/{documentId}/baseline-stages",
  responseDescriptions: {
    503: `Another request of the caller's holds its stage on the document, and the open did not wait for it. Nothing changed. Retry after the \`Retry-After\` delay (${DOCUMENT_BASELINE_STAGE_BUSY_RETRY_AFTER_SECONDS} second), once the writer's other requests to that stage have finished. Also the answer when the database cannot be reached, as on every route.`,
  },
  responseHeaders: { 503: DocumentBaselineStageBusyHeadersSchema },
  responses: { 200: DocumentBaselineStageStatusResponseSchema },
});

export const getDocumentBaselineStageOperation = defineJsonOperation({
  auth: "session",
  failureResponses: stageFailureResponses,
  failureStatuses: stageFailureStatuses,
  id: "documents.baselineStages.get",
  summary: "Get rotation baseline stage status",
  description:
    "Returns the caller's stage: the next segment index it expects, the digest of the segments staged so far, and when it expires, so a writer can resume an interrupted upload. Only the exact 404 `document_baseline_stage_not_found` or 409 `document_baseline_stage_expired` responses prove the stage is gone; any other failure means the writer keeps it.",
  method: "GET",
  params: DocumentBaselineStagePathParamsSchema,
  path: "/documents/{documentId}/baseline-stages/{baselineId}",
  responses: { 200: DocumentBaselineStageStatusResponseSchema },
});

export const abandonDocumentBaselineStageOperation = defineJsonOperation({
  auth: "session",
  failureResponses: stageFailureResponses,
  failureStatuses: stageFailureStatuses,
  id: "documents.baselineStages.abandon",
  summary: "Abandon a rotation baseline stage",
  description:
    "Deletes the caller's stage and every segment staged under it. A baseline a request already committed is not a stage and is not touched; a stage that is already gone returns 404 `document_baseline_stage_not_found`.",
  method: "DELETE",
  params: DocumentBaselineStagePathParamsSchema,
  path: "/documents/{documentId}/baseline-stages/{baselineId}",
  responses: { 200: DocumentBaselineStageAbandonResponseSchema },
});

export const stageDocumentBaselineSegmentOperation = defineJsonOperation({
  auth: "session",
  body: DocumentSyncOutgoingUpdateSchema,
  failureResponses: { ...stageFailureResponses, 413: ErrorResponseSchema },
  failureStatuses: [...stageFailureStatuses, 413],
  id: "documents.baselineStages.segments.stage",
  summary: "Stage one rotation baseline segment",
  description:
    "Stages one segment of the baseline, in index order: the server verifies its signed write header and envelope and that it starts every peer where the staged segments left it. The final segment is never staged; it travels in the rotating request. Sending the same index with the same ciphertext again is acknowledged without a write, an index that is not the stage's next returns 409 `document_baseline_stage_segment_out_of_order` naming the next one, and a segment that would take the stage past its byte or span cap returns 409 `document_baseline_stage_too_large`.",
  method: "PUT",
  params: DocumentBaselineStageSegmentPathParamsSchema,
  path: "/documents/{documentId}/baseline-stages/{baselineId}/segments/{segmentIndex}",
  responseDescriptions: {
    413: `A serialized staged segment is limited to ${MAX_DOCUMENT_BASELINE_SEGMENT_REQUEST_BYTES} bytes`,
  },
  responses: { 200: DocumentBaselineStageStatusResponseSchema },
  runtimeRefinements: [documentSyncRequestRotationRefinement],
});

export const resignDocumentBaselineSegmentHeaderOperation = defineJsonOperation(
  {
    auth: "session",
    body: DocumentBaselineStageWriteHeaderRequestSchema,
    failureResponses: { ...stageFailureResponses, 413: ErrorResponseSchema },
    failureStatuses: [...stageFailureStatuses, 413],
    id: "documents.baselineStages.segments.resign",
    summary: "Re-sign a staged segment's write header",
    description:
      "Replaces a staged segment's signed write header without uploading its ciphertext again, for a writer whose staged headers name a manifest, key-target set or signing key that has since changed. The new header must sign the same content record, metadata and ciphertext hashes at the stage's epoch. The stage's byte count moves by the difference between the two headers, and a header that would take it past the stage's bound returns 409 `document_baseline_stage_too_large`.",
    method: "PUT",
    params: DocumentBaselineStageSegmentPathParamsSchema,
    path: "/documents/{documentId}/baseline-stages/{baselineId}/segments/{segmentIndex}/write-header",
    responseDescriptions: {
      413: `A serialized write header request is limited to ${MAX_DOCUMENT_BASELINE_SEGMENT_HEADER_REQUEST_BYTES} bytes`,
    },
    responses: { 200: DocumentBaselineStageStatusResponseSchema },
  },
);

export const isOpenDocumentBaselineStageOperationRequest =
  isDocumentBaselineStageOpenRequest;
export const isResignDocumentBaselineSegmentHeaderOperationRequest =
  isDocumentBaselineStageWriteHeaderRequest;
export const isDocumentBaselineStageStatusOperationResponse =
  isDocumentBaselineStageStatusResponse;
export const isAbandonDocumentBaselineStageOperationResponse =
  isDocumentBaselineStageAbandonResponse;

import {
  DOCUMENT_BASELINE_STAGE_ERROR_CODES,
  type DocumentBaselineStageErrorCode,
} from "@tearleads/validators/response";
import type { DocumentBaselineStageState } from "../../../documents/documentBaselineStageState";
import { isUniqueViolation } from "../../../utils/databaseErrors";
import { toMutationError } from "../mutations/errors";

type DocumentBaselineStageStatus = 400 | 403 | 404 | 409 | 503;

/** A refused stage request, with the code its response carries, if any. */
export class DocumentBaselineStageError extends Error {
  constructor(
    message: string,
    readonly status: DocumentBaselineStageStatus,
    readonly code?: DocumentBaselineStageErrorCode | undefined,
    /** With `segment_out_of_order`: the index the stage expects next. */
    readonly nextSegmentIndex?: number | undefined,
  ) {
    super(message);
    this.name = "DocumentBaselineStageError";
  }
}

export function documentBaselineStageNotFound(): DocumentBaselineStageError {
  return new DocumentBaselineStageError(
    "Document baseline stage not found",
    404,
    DOCUMENT_BASELINE_STAGE_ERROR_CODES.notFound,
  );
}

function documentBaselineStageExpired(): DocumentBaselineStageError {
  return new DocumentBaselineStageError(
    "Document baseline stage expired",
    409,
    DOCUMENT_BASELINE_STAGE_ERROR_CODES.expired,
  );
}

export function documentBaselineStageEpochStale(
  reason: string,
): DocumentBaselineStageError {
  return new DocumentBaselineStageError(
    `Document baseline stage cannot commit: ${reason}`,
    409,
    DOCUMENT_BASELINE_STAGE_ERROR_CODES.epochStale,
  );
}

export function documentBaselineStageIdConflict(): DocumentBaselineStageError {
  return new DocumentBaselineStageError(
    "Document baseline id is already in use",
    409,
    DOCUMENT_BASELINE_STAGE_ERROR_CODES.idConflict,
  );
}

export function stagedSegmentInvalid(
  reason: string,
): DocumentBaselineStageError {
  return new DocumentBaselineStageError(
    `Document baseline segment cannot be staged: ${reason}`,
    409,
    DOCUMENT_BASELINE_STAGE_ERROR_CODES.segmentInvalid,
  );
}

export function stagedSegmentConflict(): DocumentBaselineStageError {
  return new DocumentBaselineStageError(
    "Document baseline segment conflicts with what is stored",
    409,
    DOCUMENT_BASELINE_STAGE_ERROR_CODES.segmentConflict,
  );
}

export function stagedSegmentOutOfOrder(
  nextSegmentIndex: number,
): DocumentBaselineStageError {
  return new DocumentBaselineStageError(
    "Document baseline segment is not the stage's next",
    409,
    DOCUMENT_BASELINE_STAGE_ERROR_CODES.segmentOutOfOrder,
    nextSegmentIndex,
  );
}

/** The open stage a request may act on, or the refusal the caller gets. */
export function requireOpenDocumentBaselineStage(
  state: DocumentBaselineStageState,
) {
  if (state.status === "absent") throw documentBaselineStageNotFound();
  if (state.status === "expired") throw documentBaselineStageExpired();
  return state.stage;
}

/**
 * What a stage request's failure reaches the route as. A check shared with
 * the document mutations (access, the signer, a header's shape or signature)
 * fails as it does there, without a stage code: it says nothing about the
 * stage. A document mutation's 404 is not the stage's coded one, so it
 * becomes a conflict. A unique violation is a write that raced another;
 * `raced` names what it was for the route that hit it.
 */
export function toDocumentBaselineStageError(
  error: unknown,
  raced: () => DocumentBaselineStageError,
): DocumentBaselineStageError | null {
  if (error instanceof DocumentBaselineStageError) return error;
  if (isUniqueViolation(error)) return raced();
  const mutationError = toMutationError(error);
  if (!mutationError) return null;
  return new DocumentBaselineStageError(
    mutationError.message,
    mutationError.status === 404 ? 409 : mutationError.status,
  );
}

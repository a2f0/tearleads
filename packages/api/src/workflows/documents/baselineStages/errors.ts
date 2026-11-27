import {
  DOCUMENT_BASELINE_STAGE_ERROR_CODES,
  type DocumentBaselineStageConflictCode,
} from "@tearleads/validators/response";
import type { DocumentBaselineStageState } from "../../../documents/documentBaselineStageState";
import { isUniqueViolation } from "../../../utils/databaseErrors";
import { toMutationError } from "../mutations/errors";

type DocumentBaselineStageRefusalStatus = 400 | 403 | 409 | 503;

/** One of a caller's open stages, as a `limit_reached` refusal names it. */
export interface DocumentBaselineOpenStage {
  readonly baselineId: string;
  readonly documentId: string;
  readonly expiresAt: string;
}

/**
 * A refused stage request, with the code its response carries, if any. The
 * codes are the ones a stage route's 409 may carry: a missing stage is the
 * subclass below, and stale headers are only a commit's to find.
 */
export class DocumentBaselineStageError extends Error {
  constructor(
    message: string,
    readonly status: DocumentBaselineStageRefusalStatus | 404,
    readonly code?: DocumentBaselineStageConflictCode | undefined,
    /** With `segment_out_of_order`: the index the stage expects next. */
    readonly nextSegmentIndex?: number | undefined,
    /** With `limit_reached`: the caller's open stages on other documents. */
    readonly openStages?: readonly DocumentBaselineOpenStage[] | undefined,
  ) {
    super(message);
    this.name = "DocumentBaselineStageError";
  }
}

/**
 * No stage of this caller under that id on that document: the one failure a
 * stage route answers with a 404, always with the stage's own code.
 */
export class DocumentBaselineStageNotFoundError extends DocumentBaselineStageError {
  constructor() {
    super("Document baseline stage not found", 404);
    this.name = "DocumentBaselineStageNotFoundError";
  }
}

function stageConflict(
  message: string,
  code: DocumentBaselineStageConflictCode,
  nextSegmentIndex?: number,
): DocumentBaselineStageError {
  return new DocumentBaselineStageError(message, 409, code, nextSegmentIndex);
}

export function documentBaselineStageNotFound(): DocumentBaselineStageError {
  return new DocumentBaselineStageNotFoundError();
}

export function documentBaselineStageEpochStale(
  reason: string,
): DocumentBaselineStageError {
  return stageConflict(
    `Document baseline stage cannot commit: ${reason}`,
    DOCUMENT_BASELINE_STAGE_ERROR_CODES.epochStale,
  );
}

export function documentBaselineStageIdConflict(): DocumentBaselineStageError {
  return stageConflict(
    "Document baseline id is already in use",
    DOCUMENT_BASELINE_STAGE_ERROR_CODES.idConflict,
  );
}

/**
 * The caller holds as many open stages as one user may. The refusal names
 * them: a writer that lost track of a stage has no other way to learn its
 * id, and would wait out its expiry. They are the caller's own.
 */
export function documentBaselineStageLimitReached(
  openStages: readonly DocumentBaselineOpenStage[],
): DocumentBaselineStageError {
  return new DocumentBaselineStageError(
    "Too many open document baseline stages",
    409,
    DOCUMENT_BASELINE_STAGE_ERROR_CODES.limitReached,
    undefined,
    openStages,
  );
}

/**
 * A request of the caller's own holds the stage this one would replace. It
 * is not a conflict the writer resolves: the same request sent again finds
 * the stage free.
 */
export function documentBaselineStageBusy(): DocumentBaselineStageError {
  return new DocumentBaselineStageError(
    "Document baseline stage is in use by another request; retry",
    503,
  );
}

/** The segment would take the stage past what one stage may store. */
export function documentBaselineStageTooLarge(
  bound: string,
): DocumentBaselineStageError {
  return stageConflict(
    `Document baseline stage would exceed its ${bound}`,
    DOCUMENT_BASELINE_STAGE_ERROR_CODES.tooLarge,
  );
}

export function stagedSegmentInvalid(
  reason: string,
): DocumentBaselineStageError {
  return stageConflict(
    `Document baseline segment cannot be staged: ${reason}`,
    DOCUMENT_BASELINE_STAGE_ERROR_CODES.segmentInvalid,
  );
}

export function stagedSegmentConflict(): DocumentBaselineStageError {
  return stageConflict(
    "Document baseline segment conflicts with what is stored",
    DOCUMENT_BASELINE_STAGE_ERROR_CODES.segmentConflict,
  );
}

export function stagedSegmentOutOfOrder(
  nextSegmentIndex: number,
): DocumentBaselineStageError {
  return stageConflict(
    "Document baseline segment is not the stage's next",
    DOCUMENT_BASELINE_STAGE_ERROR_CODES.segmentOutOfOrder,
    nextSegmentIndex,
  );
}

/** The open stage a request may act on, or the refusal the caller gets. */
export function requireOpenDocumentBaselineStage(
  state: DocumentBaselineStageState,
) {
  if (state.status === "absent") throw documentBaselineStageNotFound();
  if (state.status === "expired") {
    throw stageConflict(
      "Document baseline stage expired",
      DOCUMENT_BASELINE_STAGE_ERROR_CODES.expired,
    );
  }
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

import { DOCUMENT_BASELINE_STAGE_ERROR_CODES } from "@tearleads/validators/response";
import {
  MAX_DOCUMENT_BASELINE_STAGE_BYTES,
  MAX_DOCUMENT_STAGED_BASELINE_SEGMENTS,
  MAX_OPEN_DOCUMENT_BASELINE_STAGES_PER_USER,
} from "@tearleads/validators/util";
import { DocumentSyncRequestLimitError } from "../../../data/documents/shared/sync/documentSyncOutgoingBatch";

/**
 * A stage request the upload does not recover from in this run: a refusal
 * with no stage code (access, billing, a malformed request, an outage), or
 * a coded one after the run already started over. Nothing is retried
 * blindly. A refusal the API gave on purpose ends the upload and deletes
 * its stage; a request that got no answer leaves the stage for the next run
 * to read.
 */
export class DocumentRotationBaselineStageError extends Error {
  override readonly name: string = "DocumentRotationBaselineStageError";

  constructor(
    message: string,
    /** The refusal's code, when the API sent one. */
    readonly code: string | undefined,
    readonly status: number | null,
  ) {
    super(message);
  }
}

export function isDocumentRotationBaselineStageError(
  error: unknown,
): error is DocumentRotationBaselineStageError {
  return error instanceof DocumentRotationBaselineStageError;
}

/**
 * The user already holds as many open baseline stages as the API lets one
 * user hold (`MAX_OPEN_DOCUMENT_BASELINE_STAGES_PER_USER`): other uploads
 * are in flight, or stages a restarted process left are still to expire.
 * Nothing was opened and nothing is retried; the rotation goes once one of
 * them commits, is abandoned, or expires.
 */
export class DocumentRotationBaselineStageLimitError extends DocumentRotationBaselineStageError {
  override readonly name = "DocumentRotationBaselineStageLimitError";

  constructor() {
    super(
      `Document rotation baseline cannot be staged: ${MAX_OPEN_DOCUMENT_BASELINE_STAGES_PER_USER} other baseline uploads are open for this user`,
      DOCUMENT_BASELINE_STAGE_ERROR_CODES.limitReached,
      409,
    );
  }
}

const LIMIT_MESSAGES = {
  segment_limit: `needs more than ${MAX_DOCUMENT_STAGED_BASELINE_SEGMENTS} segments`,
  stage_too_large: `is larger than the ${MAX_DOCUMENT_BASELINE_STAGE_BYTES} bytes or the span rows a stage stores`,
} as const;

/**
 * The history is larger than a staged baseline may be: it needs more
 * segments than a baseline has (`MAX_DOCUMENT_STAGED_BASELINE_SEGMENTS`),
 * or more bytes or span rows than a stage stores
 * (`MAX_DOCUMENT_BASELINE_STAGE_BYTES`, `MAX_DOCUMENT_BASELINE_STAGE_SPANS`).
 * No retry changes that: the document cannot rotate from this writer. It is
 * a request-limit error, so a sync that heals ends in the coded failure
 * `document_sync_request_too_large` and an unlink throws it.
 */
export class DocumentRotationBaselineLimitError extends DocumentSyncRequestLimitError {
  constructor(readonly limit: keyof typeof LIMIT_MESSAGES) {
    super(`Document rotation baseline ${LIMIT_MESSAGES[limit]}`);
  }
}

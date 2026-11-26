import { MAX_DOCUMENT_STAGED_BASELINE_SEGMENTS } from "@tearleads/validators/util";
import { DocumentSyncRequestLimitError } from "../../../data/documents/shared/sync/documentSyncOutgoingBatch";

/**
 * A stage request the upload does not recover from in this run: a refusal
 * with no stage code (access, billing, a malformed request, an outage), or
 * a coded one after the run already started over. The stage is left as it
 * was. The next run reads it and goes on, or finds it expired and starts
 * over; nothing is retried blindly.
 */
export class DocumentRotationBaselineStageError extends Error {
  override readonly name = "DocumentRotationBaselineStageError";

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
 * The history needs more segments than a staged baseline may hold
 * (`MAX_DOCUMENT_STAGED_BASELINE_SEGMENTS`). No retry changes that: the
 * document cannot rotate from this writer at these segment sizes. It is a
 * request-limit error, so a sync that heals ends in the coded failure
 * `document_sync_request_too_large` and an unlink throws it to its caller.
 */
export class DocumentRotationBaselineSegmentLimitError extends DocumentSyncRequestLimitError {
  constructor() {
    super(
      `Document rotation baseline needs more than ${MAX_DOCUMENT_STAGED_BASELINE_SEGMENTS} segments`,
    );
  }
}

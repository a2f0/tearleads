import type {
  DocumentNotFoundErrorCode,
  DocumentProjectionErrorCode,
  DocumentSyncErrorCode,
} from "@tearleads/validators/response";
import { DOCUMENT_PROJECTION_ERROR_CODES } from "@tearleads/validators/response";

type DocumentWriterProjectionStatus = 403 | 404 | 409;

export class DocumentWriterProjectionError extends Error {
  readonly code?:
    | DocumentNotFoundErrorCode
    | DocumentProjectionErrorCode
    | DocumentSyncErrorCode
    | undefined;

  constructor(
    message: string,
    readonly status: DocumentWriterProjectionStatus,
    code?:
      | DocumentNotFoundErrorCode
      | DocumentProjectionErrorCode
      | DocumentSyncErrorCode
      | undefined,
  ) {
    super(message);
    this.name = "DocumentWriterProjectionError";
    // Every 409 must carry a stable code — an uncoded conflict is
    // undiagnosable from a System Monitor report. Malformed stored state is
    // the fail-safe class for paths that do not name a more specific one.
    this.code =
      code ??
      (status === 409
        ? DOCUMENT_PROJECTION_ERROR_CODES.stateInvalid
        : undefined);
  }
}

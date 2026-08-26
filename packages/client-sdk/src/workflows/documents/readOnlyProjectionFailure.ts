import { KeyingVerificationError } from "@symcrypt/crypto";
import { isDocumentSyncUpdateIsolationError } from "../../data/documents/shared/documentSyncUpdateIsolation";
import { rethrowKeyingVerificationError } from "../../data/keyingProjectionVerification/error";
import { DocumentRawHistoryUnavailableError } from "./syncContentKeys";
import { projectionIntegrityErrorCode } from "./syncFailureClassification";

export const REFRESH_CACHED_PROJECTION = Symbol("refresh cached projection");

export function handleReadOnlyProjectionCompletionError(
  error: unknown,
  input: {
    allowCachedProjectionRefresh: boolean;
    historyMode?: "raw" | undefined;
  },
): null | typeof REFRESH_CACHED_PROJECTION {
  if (isDocumentSyncUpdateIsolationError(error)) {
    throw error;
  }
  if (error instanceof DocumentRawHistoryUnavailableError) {
    if (input.allowCachedProjectionRefresh) {
      return REFRESH_CACHED_PROJECTION;
    }
    throw error;
  }
  if (
    input.allowCachedProjectionRefresh &&
    error instanceof KeyingVerificationError &&
    error.code === "invalid_shape"
  ) {
    return REFRESH_CACHED_PROJECTION;
  }
  // The document-store `document.sync` boundary owns durable reporting; this
  // helper only decides whether an ordinary projection miss is retryable.
  rethrowKeyingVerificationError(error);
  if (projectionIntegrityErrorCode(error) || input.historyMode === "raw") {
    throw error;
  }
  return null;
}

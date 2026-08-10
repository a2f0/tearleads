import { KeyingVerificationError } from "@tearleads/crypto";
import { DOCUMENT_SYNC_ERROR_CODES } from "@tearleads/validators/response";
import {
  isRetryableDocumentSyncConflict,
  isUpstreamDeletedDocumentSyncFailure,
} from "../../data/documents/shared/responses";
import type { DocumentSyncSubmitFailure } from "../../data/documents/shared/types";
import { isKeyingVerificationError } from "../../data/keyingProjectionVerification/error";

export type RemoteDocumentDeletionHandler = (input: {
  readonly documentId: string;
}) => Promise<void> | void;

/**
 * Invoked when a submission fails terminally — the failure is neither a
 * retryable conflict nor a recoverable update-id conflict, so the sync pass
 * stops and the pending writes stay queued (e.g. a 403 after write access was
 * revoked). Callers persist the failure so the write queue can surface it.
 */
export type TerminalSubmitFailureHandler = (
  failure: DocumentSyncSubmitFailure,
) => Promise<void> | void;

/**
 * Read-only counterpart to describeDocumentSyncSubmitFailure: names a refused
 * revalidation without implying a blocked write. 403s never reach this — a
 * read-only 403 is deliberately suppressed (edge-case row 9) so unattempted
 * local edits are never flagged.
 */
export function describeDocumentRevalidationFailure(
  failure: Pick<DocumentSyncSubmitFailure, "message" | "status">,
): string {
  const detail =
    failure.message.trim().length > 0
      ? failure.message.trim()
      : "the server refused the read";
  const suffix = failure.status === null ? "" : ` (${failure.status})`;
  return `Remote revalidation failed: ${detail}${suffix}`;
}

/** Human-readable description of a terminal submit failure for queue display. */
export function describeDocumentSyncSubmitFailure(
  failure: Pick<DocumentSyncSubmitFailure, "message" | "status">,
): string {
  if (failure.status === 403) {
    return "Write access denied by the server (403)";
  }
  const message =
    failure.message.trim().length > 0 ? failure.message.trim() : "Sync failed";
  return failure.status === null ? message : `${message} (${failure.status})`;
}

type ProjectionIntegrityErrorCode =
  | "equivocation"
  | "rollback"
  | "stale_predecessor";

function keyingVerificationErrorCode(error: unknown): string | null {
  if (!isKeyingVerificationError(error) || !(error instanceof Error)) {
    return null;
  }
  const code = Reflect.get(error, "code");
  return typeof code === "string" ? code : null;
}

export function projectionIntegrityErrorCode(
  error: unknown,
): ProjectionIntegrityErrorCode | null {
  if (
    !(error instanceof KeyingVerificationError) &&
    !(error instanceof Error && error.name === "KeyingVerificationError")
  ) {
    return null;
  }

  const code = keyingVerificationErrorCode(error);
  return code === "rollback" ||
    code === "equivocation" ||
    code === "stale_predecessor"
    ? code
    : null;
}

export function shouldRetrySyncWithFreshWriterProjection(
  error: unknown,
): boolean {
  // A cached writer projection older than a checkpoint we already recorded
  // ("rollback") — typical right after a peer shared/rotated a linked
  // container — is resolved by refetching the current projection. The refetch
  // is safe: it cannot bypass the anti-rollback check, because a genuinely
  // rolled-back server response re-throws on the rebuilt plan.
  const integrityErrorCode = projectionIntegrityErrorCode(error);
  if (integrityErrorCode) {
    return integrityErrorCode === "rollback";
  }
  if (keyingVerificationErrorCode(error) === "invalid_shape") {
    // Verification boundaries normalize malformed/stale projection data to a
    // terminal error. One cache eviction is still safe: a dishonest or broken
    // fresh response fails again outside this retry boundary.
    return true;
  }
  if (isKeyingVerificationError(error)) {
    return false;
  }

  return (
    error instanceof Error &&
    error.message.startsWith(
      "Document authorizing container KEK path could not be unwrapped",
    ) &&
    error.message.includes("Container writer projection KEK")
  );
}

export function isRecoverableDocumentUpdateIdConflict(
  failure: DocumentSyncSubmitFailure,
): boolean {
  return (
    failure.status === 409 &&
    failure.code === DOCUMENT_SYNC_ERROR_CODES.updateIdConflict
  );
}

/**
 * The server's covering-baseline gate refused a queued rotation checkpoint
 * (e.g. a leftover from an interrupted recovery or a lost heal ack) because
 * it no longer covers the committed frontier. The pass can repair itself by
 * regenerating a fresh covering baseline from the live document instead of
 * resubmitting the stale payload — which would fail terminally forever.
 */
export function isCheckpointCoverageConflict(
  failure: DocumentSyncSubmitFailure,
): boolean {
  return (
    failure.status === 409 &&
    failure.message.includes(
      "Document content-key rotation baseline does not cover the committed frontier",
    )
  );
}

/**
 * A create submitted with a stable documentId whose first attempt already
 * committed server-side comes back as this 409 (see the server's
 * `assertCreateCanAdvanceDocumentHead`). It is not a failure — the caller adopts
 * the existing remote document instead of creating a duplicate.
 */
export function isDocumentManifestAlreadyExistsConflict(failure: {
  readonly message: string;
  readonly status: number | null;
}): boolean {
  return (
    failure.status === 409 &&
    failure.message.includes("Document manifest already exists")
  );
}

export function canRetryDocumentSyncConflict(input: {
  attempt: number;
  failure: DocumentSyncSubmitFailure;
  maxAttempts: number;
}): boolean {
  return (
    input.attempt < input.maxAttempts &&
    isRetryableDocumentSyncConflict(input.failure)
  );
}

export function canRecoverDocumentUpdateIdConflict(input: {
  attempt: number;
  failure: DocumentSyncSubmitFailure;
  maxAttempts: number;
  pendingUpdateCount: number;
}): boolean {
  return (
    input.attempt < input.maxAttempts &&
    input.pendingUpdateCount > 0 &&
    isRecoverableDocumentUpdateIdConflict(input.failure)
  );
}

export async function handleUpstreamDeletedDocumentSyncFailure(input: {
  documentId: string;
  failure: DocumentSyncSubmitFailure;
  onRemoteDocumentDeleted?: RemoteDocumentDeletionHandler | undefined;
}): Promise<boolean> {
  if (!isUpstreamDeletedDocumentSyncFailure(input.failure)) {
    return false;
  }

  await input.onRemoteDocumentDeleted?.({ documentId: input.documentId });
  return true;
}

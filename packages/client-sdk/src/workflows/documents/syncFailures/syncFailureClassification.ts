import {
  DOCUMENT_MUTATION_ERROR_CODES,
  DOCUMENT_SYNC_ERROR_CODES,
} from "@tearleads/validators/response";
import { isOrganizationTwoFactorRefusal } from "../../../data/containers/shared/mutationFailures";
import { shouldRetryWithFreshProjection } from "../../../data/documents/shared/projection/freshProjectionRetry";
import {
  isRetryableDocumentSyncConflict,
  isUpstreamDeletedDocumentSyncFailure,
} from "../../../data/documents/shared/responses";
import type { DocumentSyncSubmitFailure } from "../../../data/documents/shared/sync/syncSubmitFailure";

import type { ExecSql } from "../../../data/sqlite/sqlSchema";

export type RemoteDocumentDeletionHandler = (input: {
  /** Present only after the SDK has verified the signed terminal purge proof. */
  readonly commitPurgeProof?:
    | ((transactionExecSql: ExecSql) => Promise<void>)
    | undefined;
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
  failure: Pick<DocumentSyncSubmitFailure, "code" | "message" | "status">,
): string {
  if (isOrganizationTwoFactorRefusal(failure)) {
    return "The organization requires two-factor sign-in (403)";
  }
  if (failure.status === 403) {
    return "Write access denied by the server (403)";
  }
  const message =
    failure.message.trim().length > 0 ? failure.message.trim() : "Sync failed";
  return failure.status === null ? message : `${message} (${failure.status})`;
}

export function shouldRetrySyncWithFreshWriterProjection(
  error: unknown,
): boolean {
  return shouldRetryWithFreshProjection(
    error,
    (message) =>
      message.startsWith(
        "Document authorizing container KEK path could not be unwrapped",
      ) && message.includes("Container writer projection KEK"),
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
 * A create submitted with a stable documentId whose first attempt already
 * committed server-side comes back as this 409 (see the server's
 * `assertCreateCanAdvanceDocumentHead`). It is not a failure — the caller adopts
 * the existing remote document instead of creating a duplicate.
 */
export function isDocumentManifestAlreadyExistsConflict(failure: {
  readonly code?: string | undefined;
  readonly message: string;
  readonly status: number | null;
}): boolean {
  return (
    failure.status === 409 &&
    failure.code === DOCUMENT_MUTATION_ERROR_CODES.manifestAlreadyExists
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

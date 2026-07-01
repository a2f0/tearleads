import { KeyingVerificationError } from "@tearleads/crypto";
import type {
  DocumentSyncResponse,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import {
  isRetryableDocumentSyncConflict,
  isUpstreamDeletedDocumentSyncFailure,
  submitDocumentSync,
} from "../../data/documents/shared/responses";
import type {
  DocumentSyncApi,
  DocumentSyncPlan,
  DocumentSyncSubmitFailure,
  MaterializedDocumentSyncPlan,
} from "../../data/documents/shared/types";
import type { PendingUpdateRecord } from "../../data/sqlite/documentPersistence";

export const REMOTE_DOCUMENT_DELETED = Symbol("remoteDocumentDeleted");

export type RemoteDocumentDeletionHandler = (input: {
  readonly documentId: string;
}) => Promise<void> | void;

type DocumentWriterProjectionResolution =
  | DocumentWriterProjectionResponse
  | typeof REMOTE_DOCUMENT_DELETED
  | null;

type FailedDocumentSyncAction =
  | "retry"
  | "stop"
  | {
      readonly kind: "recover_update_id_conflict";
      readonly recoveryPendingUpdatesById: Map<string, PendingUpdateRecord>;
    };

type DocumentSyncAttemptSubmission =
  | {
      readonly kind: "completed";
      readonly response: DocumentSyncResponse;
    }
  | FailedDocumentSyncAction;

function shouldRetrySyncWithFreshWriterProjection(error: unknown): boolean {
  // A cached writer projection older than a checkpoint we already recorded
  // ("rollback") — typical right after a peer shared/rotated a linked
  // container — is resolved by refetching the current projection. The refetch
  // is safe: it cannot bypass the anti-rollback check, because a genuinely
  // rolled-back server response re-throws on the rebuilt plan.
  if (error instanceof KeyingVerificationError && error.code === "rollback") {
    return true;
  }

  return (
    error instanceof Error &&
    error.message.startsWith(
      "Document authorizing container KEK path could not be unwrapped",
    ) &&
    error.message.includes("Container writer projection KEK")
  );
}

function isRecoverableDocumentUpdateIdConflict(
  failure: DocumentSyncSubmitFailure,
): boolean {
  return (
    failure.status === 409 &&
    failure.message.includes("Document update id conflict")
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

function canRetryDocumentSyncConflict(input: {
  attempt: number;
  failure: DocumentSyncSubmitFailure;
  maxAttempts: number;
}): boolean {
  return (
    input.attempt < input.maxAttempts &&
    isRetryableDocumentSyncConflict(input.failure)
  );
}

function canRecoverDocumentUpdateIdConflict(input: {
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

async function resolveFailedDocumentSyncAction(input: {
  attempt: number;
  documentId: string;
  failure: DocumentSyncSubmitFailure;
  maxAttempts: number;
  onRemoteDocumentDeleted?: RemoteDocumentDeletionHandler | undefined;
  pendingUpdates: readonly PendingUpdateRecord[];
}): Promise<FailedDocumentSyncAction> {
  if (
    await handleUpstreamDeletedDocumentSyncFailure({
      documentId: input.documentId,
      failure: input.failure,
      onRemoteDocumentDeleted: input.onRemoteDocumentDeleted,
    })
  ) {
    return "stop";
  }

  if (
    canRetryDocumentSyncConflict({
      attempt: input.attempt,
      failure: input.failure,
      maxAttempts: input.maxAttempts,
    })
  ) {
    return "retry";
  }

  if (
    canRecoverDocumentUpdateIdConflict({
      attempt: input.attempt,
      failure: input.failure,
      maxAttempts: input.maxAttempts,
      pendingUpdateCount: input.pendingUpdates.length,
    })
  ) {
    return {
      kind: "recover_update_id_conflict",
      recoveryPendingUpdatesById: new Map(
        input.pendingUpdates.map((update) => [update.id, update]),
      ),
    };
  }

  input.failure.report();
  return "stop";
}

export async function submitDocumentSyncAttempt(input: {
  apiClient: DocumentSyncApi;
  attempt: number;
  documentId: string;
  maxAttempts: number;
  onRemoteDocumentDeleted?: RemoteDocumentDeletionHandler | undefined;
  pendingUpdates: readonly PendingUpdateRecord[];
  plan: DocumentSyncPlan;
}): Promise<DocumentSyncAttemptSubmission> {
  const submitted = await submitDocumentSync({
    apiClient: input.apiClient,
    plan: input.plan,
  });
  if (!submitted) {
    return "stop";
  }
  if (submitted.ok) {
    return {
      kind: "completed",
      response: submitted.response,
    };
  }

  return resolveFailedDocumentSyncAction({
    attempt: input.attempt,
    documentId: input.documentId,
    failure: submitted,
    maxAttempts: input.maxAttempts,
    onRemoteDocumentDeleted: input.onRemoteDocumentDeleted,
    pendingUpdates: input.pendingUpdates,
  });
}

export async function resolveDocumentSyncWriterProjection(input: {
  apiClient: DocumentSyncApi;
  documentId: string;
  reusableWriterProjection: DocumentWriterProjectionResponse | null;
}): Promise<DocumentWriterProjectionResolution> {
  if (input.reusableWriterProjection) {
    return input.reusableWriterProjection;
  }

  if (input.apiClient.getDocumentWriterProjectionResult) {
    const result = await input.apiClient.getDocumentWriterProjectionResult(
      input.documentId,
      { reportErrors: false },
    );
    if (result.ok) {
      return result.data;
    }
    if (isUpstreamDeletedDocumentSyncFailure(result)) {
      return REMOTE_DOCUMENT_DELETED;
    }

    result.report();
    return null;
  }

  return input.apiClient.getDocumentWriterProjection(input.documentId);
}

export async function retrySyncPlan(input: {
  apiClient: DocumentSyncApi;
  buildWithProjection: (
    projection: DocumentWriterProjectionResponse,
  ) => Promise<MaterializedDocumentSyncPlan>;
  documentId: string;
  onRemoteDocumentDeleted?: RemoteDocumentDeletionHandler | undefined;
  writerProjection: DocumentWriterProjectionResponse;
}): Promise<
  | readonly [MaterializedDocumentSyncPlan, DocumentWriterProjectionResponse]
  | null
> {
  try {
    return [
      await input.buildWithProjection(input.writerProjection),
      input.writerProjection,
    ];
  } catch (error) {
    if (
      !input.apiClient.clearWriterProjectionCaches ||
      !shouldRetrySyncWithFreshWriterProjection(error)
    ) {
      throw error;
    }
  }

  input.apiClient.clearWriterProjectionCaches();
  const writerProjection = await resolveDocumentSyncWriterProjection({
    apiClient: input.apiClient,
    documentId: input.documentId,
    reusableWriterProjection: null,
  });
  if (writerProjection === REMOTE_DOCUMENT_DELETED) {
    await input.onRemoteDocumentDeleted?.({ documentId: input.documentId });
    return null;
  }
  if (!writerProjection) {
    return null;
  }

  return [await input.buildWithProjection(writerProjection), writerProjection];
}

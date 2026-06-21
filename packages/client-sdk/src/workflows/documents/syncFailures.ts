import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import {
  isRetryableDocumentSyncConflict,
  isUpstreamDeletedDocumentSyncFailure,
} from "../../data/documents/shared/responses";
import type {
  DocumentSyncApi,
  DocumentSyncSubmitFailure,
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

function isRecoverableDocumentUpdateIdConflict(
  failure: DocumentSyncSubmitFailure,
): boolean {
  return (
    failure.status === 409 &&
    failure.message.includes("Document update id conflict")
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

export async function resolveFailedDocumentSyncAction(input: {
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

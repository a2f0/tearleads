import type {
  DocumentSyncResponse,
  DocumentWriterProjectionResponse,
} from "@symcrypt/validators/response";
import {
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
import {
  canRecoverDocumentUpdateIdConflict,
  canRetryDocumentSyncConflict,
  handleUpstreamDeletedDocumentSyncFailure,
  isCheckpointCoverageConflict,
  type RemoteDocumentDeletionHandler,
  shouldRetrySyncWithFreshWriterProjection,
  type TerminalSubmitFailureHandler,
} from "./syncFailureClassification";
import {
  type DocumentSyncTraceEmitter,
  traceProjectionFailed,
  traceSubmitFailed,
} from "./syncTrace";

const REMOTE_DOCUMENT_DELETED = Symbol("remoteDocumentDeleted");

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
    }
  | { readonly kind: "regenerate_queued_checkpoints" };

type DocumentSyncAttemptSubmission =
  | {
      readonly kind: "completed";
      readonly pullComplete: boolean;
      readonly response: DocumentSyncResponse;
    }
  | FailedDocumentSyncAction;

async function resolveFailedDocumentSyncAction(input: {
  attempt: number;
  canRegenerateQueuedCheckpoints?: boolean | undefined;
  documentId: string;
  failure: DocumentSyncSubmitFailure;
  maxAttempts: number;
  onRemoteDocumentDeleted?: RemoteDocumentDeletionHandler | undefined;
  onSyncTrace?: DocumentSyncTraceEmitter | undefined;
  onTerminalSubmitFailure?: TerminalSubmitFailureHandler | undefined;
  pendingUpdates: readonly PendingUpdateRecord[];
}): Promise<FailedDocumentSyncAction> {
  const action = await classifyFailedDocumentSyncAction(input);
  traceSubmitFailed(input.onSyncTrace, {
    action:
      action === "retry" || action === "stop"
        ? action
        : action.kind === "recover_update_id_conflict"
          ? "recover-update-ids"
          : "regenerate-checkpoints",
    code: input.failure.code,
    documentId: input.documentId,
    status: input.failure.status,
  });
  return action;
}

async function classifyFailedDocumentSyncAction(input: {
  attempt: number;
  canRegenerateQueuedCheckpoints?: boolean | undefined;
  documentId: string;
  failure: DocumentSyncSubmitFailure;
  maxAttempts: number;
  onRemoteDocumentDeleted?: RemoteDocumentDeletionHandler | undefined;
  onTerminalSubmitFailure?: TerminalSubmitFailureHandler | undefined;
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

  if (
    input.attempt < input.maxAttempts &&
    input.canRegenerateQueuedCheckpoints === true &&
    isCheckpointCoverageConflict(input.failure)
  ) {
    return { kind: "regenerate_queued_checkpoints" };
  }

  input.failure.report();
  await input.onTerminalSubmitFailure?.(input.failure);
  return "stop";
}

async function submitDocumentSyncAttempt(input: {
  apiClient: DocumentSyncApi;
  attempt: number;
  canRegenerateQueuedCheckpoints?: boolean | undefined;
  documentId: string;
  maxAttempts: number;
  onRemoteDocumentDeleted?: RemoteDocumentDeletionHandler | undefined;
  onSyncTrace?: DocumentSyncTraceEmitter | undefined;
  onTerminalSubmitFailure?: TerminalSubmitFailureHandler | undefined;
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
      pullComplete: submitted.pullComplete,
      response: submitted.response,
    };
  }

  return resolveFailedDocumentSyncAction({
    attempt: input.attempt,
    canRegenerateQueuedCheckpoints: input.canRegenerateQueuedCheckpoints,
    documentId: input.documentId,
    failure: submitted,
    maxAttempts: input.maxAttempts,
    onRemoteDocumentDeleted: input.onRemoteDocumentDeleted,
    onSyncTrace: input.onSyncTrace,
    onTerminalSubmitFailure: input.onTerminalSubmitFailure,
    pendingUpdates: input.pendingUpdates,
  });
}

export async function submitDocumentSyncAttemptIfAllowed(
  input: Parameters<typeof submitDocumentSyncAttempt>[0] & {
    isRemoteSyncBlocked?: ((organizationId: string) => boolean) | undefined;
    onOutgoingUpdatesMaterialized?:
      | ((updateIds: readonly string[]) => void)
      | undefined;
    writeBearing?: boolean | undefined;
  },
): Promise<DocumentSyncAttemptSubmission> {
  const {
    isRemoteSyncBlocked,
    onOutgoingUpdatesMaterialized,
    writeBearing,
    ...submissionInput
  } = input;
  const hasRemoteWrites =
    input.plan.request.outgoingUpdates.length > 0 ||
    (input.plan.request.containerRekeys?.length ?? 0) > 0;
  if (hasRemoteWrites && isRemoteSyncBlocked?.(input.plan.organizationId)) {
    return "stop";
  }

  onOutgoingUpdatesMaterialized?.(
    input.plan.request.outgoingUpdates.map(({ id }) => id),
  );

  return submitDocumentSyncAttempt({
    ...submissionInput,
    // A read-only pass carries no writes, so a terminal failure describes a
    // pull, not queued local data — recording it would flag the next local
    // edit as failed before it was ever attempted. `writeBearing` keeps the
    // handler through update-id recovery, whose retry submits an empty
    // request while the durable rows still exist: a terminal 403 there IS
    // what blocks the queued edits.
    onTerminalSubmitFailure:
      hasRemoteWrites || writeBearing
        ? submissionInput.onTerminalSubmitFailure
        : undefined,
  });
}

async function resolveDocumentSyncWriterProjection(input: {
  apiClient: DocumentSyncApi;
  documentId: string;
  onSyncTrace?: DocumentSyncTraceEmitter | undefined;
  /**
   * Invoked when the projection fetch fails terminally. Write-bearing sync
   * passes persist this: without a writer projection their queued writes can
   * never submit, so the failure (e.g. a 403 after access revocation) is what
   * the write queue should surface.
   */
  onTerminalFailure?: TerminalSubmitFailureHandler | undefined;
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

    traceProjectionFailed(input.onSyncTrace, {
      code: result.code,
      documentId: input.documentId,
      status: result.status,
    });
    result.report();
    await input.onTerminalFailure?.(result);
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
  onSyncTrace?: DocumentSyncTraceEmitter | undefined;
  onTerminalFailure?: TerminalSubmitFailureHandler | undefined;
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
      !input.apiClient.evictDocumentWriterProjection ||
      !shouldRetrySyncWithFreshWriterProjection(error)
    ) {
      throw error;
    }
  }

  // Only this document's projection was stale; evict just it so unrelated
  // documents keep their warm cache instead of a global wipe.
  input.apiClient.evictDocumentWriterProjection?.(input.documentId);
  const writerProjection = await resolveDocumentSyncWriterProjection({
    apiClient: input.apiClient,
    documentId: input.documentId,
    onSyncTrace: input.onSyncTrace,
    onTerminalFailure: input.onTerminalFailure,
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

/**
 * Resolves the writer projection for one sync attempt, converting the two
 * unrecoverable outcomes into an abandoned (null) result with a named reason
 * so callers that turn a null sync into their own error can surface the real
 * cause.
 */
export async function resolveSyncAttemptWriterProjection(input: {
  apiClient: DocumentSyncApi;
  documentId: string;
  onRemoteDocumentDeleted?: RemoteDocumentDeletionHandler | undefined;
  onSyncAbandoned?: ((reason: string) => void) | undefined;
  onSyncTrace?: DocumentSyncTraceEmitter | undefined;
  onTerminalFailure?: TerminalSubmitFailureHandler | undefined;
  reusableWriterProjection: DocumentWriterProjectionResponse | null;
}): Promise<DocumentWriterProjectionResponse | null> {
  const writerProjection = await resolveDocumentSyncWriterProjection(input);
  if (writerProjection === REMOTE_DOCUMENT_DELETED) {
    await input.onRemoteDocumentDeleted?.({ documentId: input.documentId });
    input.onSyncAbandoned?.("the remote document was deleted");
    return null;
  }
  if (!writerProjection) {
    input.onSyncAbandoned?.(
      "the document writer projection could not be fetched",
    );
    return null;
  }
  return writerProjection;
}

export async function retrySyncPlanOrAbandon(input: {
  apiClient: DocumentSyncApi;
  buildWithProjection: (
    projection: DocumentWriterProjectionResponse,
  ) => Promise<MaterializedDocumentSyncPlan>;
  documentId: string;
  onRemoteDocumentDeleted?: RemoteDocumentDeletionHandler | undefined;
  onSyncAbandoned?: ((reason: string) => void) | undefined;
  onSyncTrace?: DocumentSyncTraceEmitter | undefined;
  onTerminalFailure?: TerminalSubmitFailureHandler | undefined;
  writerProjection: DocumentWriterProjectionResponse;
}): Promise<
  | readonly [MaterializedDocumentSyncPlan, DocumentWriterProjectionResponse]
  | null
> {
  const planned = await retrySyncPlan(input);
  if (!planned) {
    input.onSyncAbandoned?.(
      "a sync plan could not be built against the current projection",
    );
  }
  return planned;
}

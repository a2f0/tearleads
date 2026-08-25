import type {
  DocumentSyncResponse,
  DocumentWriterProjectionResponse,
} from "@symcrypt/validators/response";
import { isDocumentUpdateCreatedEvent } from "../../data/documents/documentSync";
import { isDocumentSyncUpdateIsolationError } from "../../data/documents/shared/documentSyncUpdateIsolation";
import {
  type DocumentSyncPullContinuation,
  InvalidDocumentSyncPullContinuationError,
  resolvePullContinuationMinLsn,
} from "../../data/documents/shared/syncPagination";
import type {
  DocumentSyncSubmitFailure,
  MaterializedDocumentSyncPlan,
  SyncRemoteDocumentResult,
} from "../../data/documents/shared/types";
import { projectionVerificationOptions } from "../../data/documents/shared/types";
import {
  type ProjectionUserKeyResolver,
  requireProjectionUserKeyResolver,
} from "../../data/keyingProjectionVerification";
import type { PendingUpdateRecord } from "../../data/sqlite/documentPersistence";
import { isDocumentSyncRequestLimitError } from "../../data/sync/documentSyncOutgoingBatch";
import {
  type SyncRemoteDocumentInput,
  tryPersistedReadOnlyDocumentSync,
} from "./readOnlySync";
import type { TerminalSubmitFailureHandler } from "./syncFailureClassification";
import {
  resolveSyncAttemptWriterProjection,
  retrySyncPlanOrAbandon,
  submitDocumentSyncAttemptIfAllowed,
} from "./syncFailures";
import { buildMaterializedDocumentSyncPlan } from "./syncPlanMaterial";
import {
  hasDeferredPendingUpdatesAfterSubmit,
  responseAcceptedRecoveryBaseline,
  submittedPendingUpdates,
} from "./syncPlanRequestBounds";
import { syncRemoteDocumentResultFromResponse } from "./syncResponseResult";
import { traceHealed } from "./syncTrace";

export function hasDocumentUpdateEvent(
  events: ReadonlyArray<unknown>,
  documentId: string | null | undefined,
): boolean {
  if (!documentId) {
    return false;
  }

  return events.some(
    (event) =>
      isDocumentUpdateCreatedEvent(event) && event.documentId === documentId,
  );
}

/**
 * After a sync submit that healed a stale content-key bundle, the cached
 * projection still carries the bundle that was just superseded; drop it so
 * later passes fetch the healed state instead of pushing another (redundant)
 * epoch bump.
 */
function evictHealedWriterProjection(
  input: SyncRemoteDocumentInput,
  materializedPlan: MaterializedDocumentSyncPlan,
  response: DocumentSyncResponse,
): void {
  if (
    materializedPlan.healedStaleContentKeyBundle &&
    responseAcceptedRecoveryBaseline(materializedPlan, response)
  ) {
    input.apiClient.evictDocumentWriterProjection?.(input.documentId);
  }
}

async function submittedDocumentSyncResult(input: {
  materializedPlan: MaterializedDocumentSyncPlan;
  pendingUpdateIds: readonly string[];
  pullComplete: boolean;
  recoveryPendingUpdatesById: ReadonlyMap<string, PendingUpdateRecord>;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  response: DocumentSyncResponse;
  sync: SyncRemoteDocumentInput;
  writerProjection: DocumentWriterProjectionResponse;
}): Promise<SyncRemoteDocumentResult> {
  const result = await syncRemoteDocumentResultFromResponse({
    ...projectionVerificationOptions(input.sync),
    execSql: input.sync.execSql,
    materializedPlan: input.materializedPlan,
    onTerminalSubmitFailure: input.sync.onTerminalSubmitFailure,
    recoveryPendingUpdatesById: input.recoveryPendingUpdatesById,
    rekeyPendingUpdate: input.sync.rekeyPendingUpdate,
    resolveWriterPublicKey: input.sync.resolveWriterPublicKey,
    response: input.response,
    targetSecretKey: input.sync.targetSecretKey,
    validateIncomingUpdates: input.sync.validateIncomingUpdates,
    writerProjection: input.writerProjection,
    resolveProjectionUserKey: input.resolveProjectionUserKey,
  });
  evictHealedWriterProjection(
    input.sync,
    input.materializedPlan,
    input.response,
  );
  if (
    input.materializedPlan.healedStaleContentKeyBundle &&
    responseAcceptedRecoveryBaseline(input.materializedPlan, input.response)
  ) {
    traceHealed(input.sync.onSyncTrace, {
      accepted: input.response.acceptedOutgoingUpdateIds.length,
      documentId: input.materializedPlan.plan.documentId,
      epoch: input.materializedPlan.plan.contentKeyEpoch,
    });
  }
  return {
    ...result,
    hasDeferredPendingUpdates:
      (input.materializedPlan.plan.request.pullCursor !== undefined &&
        input.pendingUpdateIds.length > 0 &&
        result.exhaustedPendingUpdateCount === 0) ||
      hasDeferredPendingUpdatesAfterSubmit({
        acceptedRecoveryBaseline: result.acceptedRecoveryBaseline,
        exhaustedPendingUpdateCount: result.exhaustedPendingUpdateCount,
        pendingUpdateIds: input.pendingUpdateIds,
        rekeyedPendingUpdateIds: result.rekeyedPendingUpdateIds,
        settledPendingUpdateIds: result.settledPendingUpdateIds,
      }),
    hasIncompletePull: !input.pullComplete,
  };
}

function buildRemoteDocumentSyncPlan(input: {
  minLsn?: string | undefined;
  pendingUpdates: readonly PendingUpdateRecord[];
  pullCursor?: string | undefined;
  projection: DocumentWriterProjectionResponse;
  regenerateQueuedCheckpoints: boolean;
  sync: SyncRemoteDocumentInput;
}) {
  return buildMaterializedDocumentSyncPlan({
    author: input.sync.author,
    buildRotationSnapshot: input.sync.buildRotationSnapshot,
    execSql: input.sync.execSql,
    historyMode: input.sync.historyMode,
    localVersionVector: input.sync.localVersionVector,
    minLsn: input.minLsn,
    onSyncTrace: input.sync.onSyncTrace,
    pendingUpdates: input.pendingUpdates,
    pullCursor: input.pullCursor,
    regenerateQueuedCheckpoints: input.regenerateQueuedCheckpoints,
    signedAt: input.sync.signedAt,
    targetSecretKey: input.sync.targetSecretKey,
    writerProjection: input.projection,
    ...projectionVerificationOptions(input.sync),
  });
}

/**
 * A retryable stale-projection conflict (stale KEK targets / content-key
 * bundle / write-auth manifest) means our writer projection is behind the
 * server — typically right after a peer shared or rotated a linked
 * container. Drop this document's cached projection so the next attempt
 * re-derives fresh targets instead of resubmitting the same stale ones
 * (which would 409 again and exhaust the retries without converging).
 * Scoped to this document: unrelated projections were not invalidated.
 */
function evictStaleProjectionForRetry(input: SyncRemoteDocumentInput): void {
  input.apiClient.evictDocumentWriterProjection?.(input.documentId);
}

/**
 * A pass may repair a covering-baseline rejection by regenerating queued
 * rotation checkpoints — but only when there is something to regenerate FROM
 * (a snapshot provider and queued checkpoint rows), the failed pass was not
 * already a heal or a regeneration (whose fresh baseline proves this device
 * is simply behind), and an attempt remains.
 */
function canRegenerateQueuedCheckpoints(input: {
  materializedPlan: MaterializedDocumentSyncPlan;
  pendingUpdates: readonly PendingUpdateRecord[];
  regenerateQueuedCheckpoints: boolean;
  sync: SyncRemoteDocumentInput;
}): boolean {
  return (
    !input.regenerateQueuedCheckpoints &&
    !input.materializedPlan.healedStaleContentKeyBundle &&
    input.sync.buildRotationSnapshot !== undefined &&
    input.pendingUpdates.some((update) => update.sourceVersionVector != null)
  );
}

async function submitPlannedSyncAttempt(args: {
  attempt: number;
  materializedPlan: MaterializedDocumentSyncPlan;
  maxAttempts: number;
  pendingUpdates: readonly PendingUpdateRecord[];
  pullContinuation?: DocumentSyncPullContinuation | undefined;
  regenerateQueuedCheckpoints: boolean;
  sync: SyncRemoteDocumentInput;
  failureBlocksQueuedWrites: boolean;
}) {
  try {
    return await submitDocumentSyncAttemptIfAllowed({
      apiClient: args.sync.apiClient,
      attempt: args.attempt,
      canRegenerateQueuedCheckpoints: canRegenerateQueuedCheckpoints({
        materializedPlan: args.materializedPlan,
        pendingUpdates: args.pendingUpdates,
        regenerateQueuedCheckpoints: args.regenerateQueuedCheckpoints,
        sync: args.sync,
      }),
      documentId: args.sync.documentId,
      expectedCommitLsnMode: args.pullContinuation?.commitLsnMode,
      isRemoteSyncBlocked: args.sync.isRemoteSyncBlocked,
      maxAttempts: args.maxAttempts,
      onRemoteDocumentDeleted: args.sync.onRemoteDocumentDeleted,
      onOutgoingUpdatesMaterialized: args.sync.onOutgoingUpdatesMaterialized,
      onSyncTrace: args.sync.onSyncTrace,
      onTerminalSubmitFailure: args.sync.onTerminalSubmitFailure,
      pendingUpdates: args.pendingUpdates,
      plan: args.materializedPlan.plan,
      failureBlocksQueuedWrites: args.failureBlocksQueuedWrites,
    });
  } catch (error) {
    if (
      error instanceof InvalidDocumentSyncPullContinuationError &&
      args.pullContinuation !== undefined
    ) {
      return "retry" as const;
    }
    throw error;
  }
}

/**
 * A write-bearing pass records through the submit handler (its queued writes
 * are what the failure blocks). A read-only pass records through the
 * revalidation handler so the refusal still leaves a durable trail instead
 * of silently never revalidating (edge-case row 13). A cursor continuation is
 * wire-level read-only, but its failure still blocks the queued writes it
 * deliberately deferred. Update-id recovery likewise empties the in-flight
 * batch while durable rows remain. Both keep the submit classification and
 * its 403 handling.
 */
function projectionFailureHandler(
  input: SyncRemoteDocumentInput,
  failureBlocksQueuedWrites: boolean,
): TerminalSubmitFailureHandler | undefined {
  return failureBlocksQueuedWrites
    ? input.onTerminalSubmitFailure
    : input.onReadOnlyProjectionFailure;
}

function resolveAttemptProjection(
  input: SyncRemoteDocumentInput,
  failureBlocksQueuedWrites: boolean,
  reusableWriterProjection: DocumentWriterProjectionResponse | null,
) {
  return resolveSyncAttemptWriterProjection({
    apiClient: input.apiClient,
    documentId: input.documentId,
    onRemoteDocumentDeleted: input.onRemoteDocumentDeleted,
    onSyncAbandoned: input.onSyncAbandoned,
    onSyncTrace: input.onSyncTrace,
    onTerminalFailure: projectionFailureHandler(
      input,
      failureBlocksQueuedWrites,
    ),
    reusableWriterProjection,
  });
}

function abandonAfterRetryableConflicts(input: SyncRemoteDocumentInput): null {
  input.onSyncAbandoned?.("every sync attempt hit a retryable conflict");
  return null;
}

async function abandonOversizedSyncPlan(
  input: SyncRemoteDocumentInput,
  error: Error,
): Promise<null> {
  const failure: DocumentSyncSubmitFailure = {
    code: "document_sync_request_too_large",
    message: error.message,
    ok: false,
    report: () => undefined,
    status: null,
  };
  await input.onTerminalSubmitFailure?.(failure);
  input.onSyncAbandoned?.(
    "a queued update cannot fit within the document sync request limit",
  );
  return null;
}

async function planDocumentSyncAttempt(input: {
  pendingUpdates: readonly PendingUpdateRecord[];
  pullContinuation?: DocumentSyncPullContinuation | undefined;
  regenerateQueuedCheckpoints: boolean;
  sync: SyncRemoteDocumentInput;
  failureBlocksQueuedWrites: boolean;
  writerProjection: DocumentWriterProjectionResponse;
}) {
  try {
    return await retrySyncPlanOrAbandon({
      apiClient: input.sync.apiClient,
      buildWithProjection: (projection) =>
        buildRemoteDocumentSyncPlan({
          pendingUpdates:
            input.pullContinuation === undefined ? input.pendingUpdates : [],
          minLsn: resolvePullContinuationMinLsn(
            input.pullContinuation,
            input.sync.minLsn,
          ),
          pullCursor: input.pullContinuation?.cursor,
          projection,
          regenerateQueuedCheckpoints: input.regenerateQueuedCheckpoints,
          sync: input.sync,
        }),
      documentId: input.sync.documentId,
      onRemoteDocumentDeleted: input.sync.onRemoteDocumentDeleted,
      onSyncAbandoned: input.sync.onSyncAbandoned,
      onSyncTrace: input.sync.onSyncTrace,
      onTerminalFailure: projectionFailureHandler(
        input.sync,
        input.failureBlocksQueuedWrites,
      ),
      writerProjection: input.writerProjection,
    });
  } catch (error) {
    if (!isDocumentSyncRequestLimitError(error)) {
      throw error;
    }
    return abandonOversizedSyncPlan(input.sync, error);
  }
}

function resolveRemoteSyncProjectionUserKey(input: SyncRemoteDocumentInput) {
  return requireProjectionUserKeyResolver(
    input.resolveProjectionUserKey,
    "Remote document sync",
  );
}

async function invalidatePullCursor(
  input: SyncRemoteDocumentInput,
  pullContinuation: DocumentSyncPullContinuation | undefined,
): Promise<undefined> {
  if (pullContinuation !== undefined) {
    await input.onPullContinuationInvalidated?.(pullContinuation);
  }
  return undefined;
}

async function preparePersistedDocumentSync(
  input: SyncRemoteDocumentInput,
  resolveProjectionUserKey: ProjectionUserKeyResolver,
): Promise<
  | { readonly kind: "completed"; result: SyncRemoteDocumentResult | null }
  | {
      readonly kind: "continue";
      pullContinuation: DocumentSyncPullContinuation | undefined;
    }
> {
  let pullContinuation = input.pullContinuation;
  try {
    const persisted = await tryPersistedReadOnlyDocumentSync(
      input,
      resolveProjectionUserKey,
    );
    if (persisted?.kind === "completed") return persisted;
    if (persisted?.kind === "not_completed" && input.historyMode !== "raw") {
      pullContinuation = await invalidatePullCursor(input, pullContinuation);
    }
  } catch (error) {
    if (
      !(error instanceof InvalidDocumentSyncPullContinuationError) ||
      pullContinuation === undefined
    ) {
      throw error;
    }
    pullContinuation = await invalidatePullCursor(input, pullContinuation);
  }
  return { kind: "continue", pullContinuation };
}

function failureBlocksQueuedWrites(input: {
  readonly pendingUpdates: readonly PendingUpdateRecord[];
  readonly recoveryPendingUpdateCount: number;
}): boolean {
  return (
    input.pendingUpdates.length > 0 || input.recoveryPendingUpdateCount > 0
  );
}

async function syncRemoteDocumentInternal(
  input: SyncRemoteDocumentInput,
): Promise<SyncRemoteDocumentResult | null> {
  const resolveProjectionUserKey = resolveRemoteSyncProjectionUserKey(input);
  const maxAttempts = input.apiClient.syncDocumentResult ? 3 : 1;
  let pendingUpdates = input.pendingUpdates ?? [];
  const pendingUpdateIds = pendingUpdates.map((update) => update.id);
  let recoveryPendingUpdatesById = new Map<string, PendingUpdateRecord>();
  let regenerateQueuedCheckpoints = false;
  let reusableWriterProjection = input.writerProjection ?? null;

  const persistedSync = await preparePersistedDocumentSync(
    input,
    resolveProjectionUserKey,
  );
  if (persistedSync.kind === "completed") return persistedSync.result;
  let pullContinuation = persistedSync.pullContinuation;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const blocksQueuedWrites = failureBlocksQueuedWrites({
      pendingUpdates,
      recoveryPendingUpdateCount: recoveryPendingUpdatesById.size,
    });
    const writerProjection = await resolveAttemptProjection(
      input,
      blocksQueuedWrites,
      reusableWriterProjection,
    );
    reusableWriterProjection = null;
    if (!writerProjection) return null;
    const planned = await planDocumentSyncAttempt({
      pendingUpdates,
      pullContinuation,
      regenerateQueuedCheckpoints,
      sync: input,
      failureBlocksQueuedWrites: blocksQueuedWrites,
      writerProjection,
    });
    if (!planned) {
      return null;
    }
    const [materializedPlan, plannedWriterProjection] = planned;
    const submitted = await submitPlannedSyncAttempt({
      attempt,
      materializedPlan,
      maxAttempts,
      pendingUpdates: submittedPendingUpdates(
        pendingUpdates,
        materializedPlan.plan,
      ),
      pullContinuation,
      regenerateQueuedCheckpoints,
      sync: input,
      failureBlocksQueuedWrites: blocksQueuedWrites,
    });
    if (submitted === "retry") {
      evictStaleProjectionForRetry(input);
      pullContinuation = await invalidatePullCursor(input, pullContinuation);
      continue;
    }
    if (submitted === "stop") {
      input.onSyncAbandoned?.("the sync submit failed terminally");
      return null;
    }
    if (submitted.kind === "regenerate_queued_checkpoints") {
      regenerateQueuedCheckpoints = true;
      continue;
    }
    if (submitted.kind === "recover_update_id_conflict") {
      recoveryPendingUpdatesById = submitted.recoveryPendingUpdatesById;
      pendingUpdates = [];
      continue;
    }

    return submittedDocumentSyncResult({
      materializedPlan,
      pendingUpdateIds,
      pullComplete: submitted.pullComplete,
      recoveryPendingUpdatesById,
      resolveProjectionUserKey,
      response: submitted.response,
      sync: input,
      writerProjection: plannedWriterProjection,
    });
  }

  return abandonAfterRetryableConflicts(input);
}

export async function syncRemoteDocument(
  input: SyncRemoteDocumentInput,
): Promise<SyncRemoteDocumentResult | null> {
  try {
    return await syncRemoteDocumentInternal(input);
  } catch (error) {
    if (isDocumentSyncUpdateIsolationError(error)) {
      await input.onIncomingUpdateIsolationFailure?.(error);
    }
    throw error;
  }
}

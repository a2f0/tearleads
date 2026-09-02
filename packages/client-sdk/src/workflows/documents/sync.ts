import { KeyingVerificationError } from "@tearleads/crypto";
import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
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
import {
  isProjectionVerificationCancelledError,
  type ProjectionUserKeyResolver,
  requireProjectionUserKeyResolver,
} from "../../data/keyingProjectionVerification";
import type { PendingUpdateRecord } from "../../data/sqlite/documentPersistence";
import { isDocumentSyncRequestLimitError } from "../../data/sync/documentSyncOutgoingBatch";
import { createVerifiedRemoteDocumentDeletionHandler } from "./purge";
import {
  type SyncRemoteDocumentInput,
  tryPersistedReadOnlyDocumentSync,
} from "./readOnlySync";
import type {
  RemoteDocumentSyncAttemptOutcome,
  RemoteDocumentSyncAttemptState,
} from "./syncAttemptState";
import { buildRemoteDocumentSyncPlan } from "./syncContainerRekeys";
import type { TerminalSubmitFailureHandler } from "./syncFailureClassification";
import {
  assertRawContinuationCanRetry,
  resolveSyncAttemptWriterProjection,
  retrySyncPlanOrAbandon,
  submitDocumentSyncAttemptIfAllowed,
} from "./syncFailures";
import { recoverablePendingUpdates } from "./syncPlanRequestBounds";
import { resolveSubmittedDocumentSyncResult } from "./syncSubmittedResult";

export function hasDocumentUpdateEvent(
  events: ReadonlyArray<unknown>,
  documentId: string | null | undefined,
): boolean {
  if (!documentId) return false;
  return events.some(
    (event) =>
      isDocumentUpdateCreatedEvent(event) && event.documentId === documentId,
  );
}
/**
 * A retryable stale-projection conflict means this writer projection is behind
 * the server. Evict only this document so the next attempt re-derives targets.
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
      stillCurrent: args.sync.stillCurrent,
      warmReferencedPrincipalPolicies:
        args.sync.warmReferencedPrincipalPolicies,
    });
  } catch (error) {
    if (
      error instanceof InvalidDocumentSyncPullContinuationError &&
      args.pullContinuation !== undefined &&
      args.sync.historyMode !== "raw"
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
    stillCurrent: input.stillCurrent,
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
      stillCurrent: input.sync.stillCurrent,
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
      pullContinuation === undefined ||
      input.historyMode === "raw"
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

async function runRemoteDocumentSyncAttempt(input: {
  attempt: number;
  maxAttempts: number;
  pendingUpdateIds: readonly string[];
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  state: RemoteDocumentSyncAttemptState;
  sync: SyncRemoteDocumentInput;
}): Promise<RemoteDocumentSyncAttemptOutcome> {
  if (input.sync.stillCurrent?.() === false) {
    return { kind: "complete", result: null };
  }
  const blocksQueuedWrites = failureBlocksQueuedWrites({
    pendingUpdates: input.state.pendingUpdates,
    recoveryPendingUpdateCount: input.state.recoveryPendingUpdatesById.size,
  });
  const writerProjection = await resolveAttemptProjection(
    input.sync,
    blocksQueuedWrites,
    input.state.reusableWriterProjection,
  );
  if (input.sync.stillCurrent?.() === false || !writerProjection) {
    return { kind: "complete", result: null };
  }
  const planned = await planDocumentSyncAttempt({
    pendingUpdates: input.state.pendingUpdates,
    pullContinuation: input.state.pullContinuation,
    regenerateQueuedCheckpoints: input.state.regenerateQueuedCheckpoints,
    sync: input.sync,
    failureBlocksQueuedWrites: blocksQueuedWrites,
    writerProjection,
  });
  if (!planned || input.sync.stillCurrent?.() === false) {
    return { kind: "complete", result: null };
  }
  const [materializedPlan] = planned;
  const submitted = await submitPlannedSyncAttempt({
    attempt: input.attempt,
    materializedPlan,
    maxAttempts: input.maxAttempts,
    pendingUpdates: recoverablePendingUpdates(
      input.state.pendingUpdates,
      materializedPlan,
    ),
    pullContinuation: input.state.pullContinuation,
    regenerateQueuedCheckpoints: input.state.regenerateQueuedCheckpoints,
    sync: input.sync,
    failureBlocksQueuedWrites: blocksQueuedWrites,
  });
  if (input.sync.stillCurrent?.() === false || submitted === "cancelled") {
    return { kind: "complete", result: null };
  }
  if (submitted === "retry") {
    assertRawContinuationCanRetry(
      input.sync.historyMode,
      input.state.pullContinuation,
    );
    evictStaleProjectionForRetry(input.sync);
    return {
      kind: "retry",
      pullContinuation: await invalidatePullCursor(
        input.sync,
        input.state.pullContinuation,
      ),
    };
  }
  if (submitted === "stop") {
    input.sync.onSyncAbandoned?.("the sync submit failed terminally");
    return { kind: "complete", result: null };
  }
  if (submitted.kind === "regenerate_queued_checkpoints") {
    return { kind: "regenerate" };
  }
  if (submitted.kind === "recover_update_id_conflict") {
    // A lost response may mean the server committed both this update id and an
    // inline container rekey. Force the read-only recovery pass to observe that
    // committed successor projection instead of reusing a cached predecessor.
    evictStaleProjectionForRetry(input.sync);
    return { kind: "recover", updates: submitted.recoveryPendingUpdatesById };
  }
  const result = await resolveSubmittedDocumentSyncResult({
    materializedPlan,
    pendingUpdateIds: input.pendingUpdateIds,
    pullComplete: submitted.pullComplete,
    recoveryPendingUpdatesById: input.state.recoveryPendingUpdatesById,
    resolveProjectionUserKey: input.resolveProjectionUserKey,
    response: submitted.response,
    sync: input.sync,
    writerProjection: materializedPlan.writerProjection,
  });
  return {
    kind: "complete",
    result: input.sync.stillCurrent?.() === false ? null : result,
  };
}

async function syncRemoteDocumentInternal(
  input: SyncRemoteDocumentInput,
): Promise<SyncRemoteDocumentResult | null> {
  if (input.stillCurrent?.() === false) return null;
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
  if (input.stillCurrent?.() === false) return null;
  if (persistedSync.kind === "completed") return persistedSync.result;
  let pullContinuation = persistedSync.pullContinuation;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const outcome = await runRemoteDocumentSyncAttempt({
      attempt,
      maxAttempts,
      pendingUpdateIds,
      resolveProjectionUserKey,
      state: {
        pendingUpdates,
        pullContinuation,
        recoveryPendingUpdatesById,
        regenerateQueuedCheckpoints,
        reusableWriterProjection,
      },
      sync: input,
    });
    reusableWriterProjection = null;
    if (outcome.kind === "complete") return outcome.result;
    if (outcome.kind === "retry") {
      pullContinuation = outcome.pullContinuation;
      if (input.stillCurrent?.() === false) return null;
      continue;
    }
    if (outcome.kind === "regenerate") {
      regenerateQueuedCheckpoints = true;
      continue;
    }
    recoveryPendingUpdatesById = outcome.updates;
    pendingUpdates = [];
  }
  return abandonAfterRetryableConflicts(input);
}

export async function syncRemoteDocument(
  input: SyncRemoteDocumentInput,
): Promise<SyncRemoteDocumentResult | null> {
  try {
    return await syncRemoteDocumentInternal({
      ...input,
      onRemoteDocumentDeleted: createVerifiedRemoteDocumentDeletionHandler({
        apiClient: input.apiClient,
        execSql: input.execSql,
        expectedOrganizationId: input.author.organizationId,
        onVerifiedDeletion: ({ commitPurgeProof, documentId }) => {
          if (input.stillCurrent?.() === false) return;
          if (!input.onRemoteDocumentDeleted) {
            throw new KeyingVerificationError(
              "missing_dependency",
              "Remote document deletion requires atomic local teardown",
            );
          }
          return input.onRemoteDocumentDeleted({
            commitPurgeProof,
            documentId,
          });
        },
        resolveProjectionUserKey: input.resolveProjectionUserKey,
      }),
    });
  } catch (error) {
    if (isProjectionVerificationCancelledError(error)) return null;
    if (
      input.stillCurrent?.() !== false &&
      isDocumentSyncUpdateIsolationError(error)
    ) {
      await input.onIncomingUpdateIsolationFailure?.(error);
    }
    throw error;
  }
}

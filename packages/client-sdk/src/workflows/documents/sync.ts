import type {
  DocumentSyncResponse,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import { isDocumentUpdateCreatedEvent } from "../../data/documentSync";
import type {
  MaterializedDocumentSyncPlan,
  SyncRemoteDocumentResult,
} from "../../data/documents/shared/types";
import { projectionVerificationOptions } from "../../data/documents/shared/types";
import {
  type ProjectionUserKeyResolver,
  requireProjectionUserKeyResolver,
} from "../../data/keyingProjectionVerification";
import type { PendingUpdateRecord } from "../../data/sqlite/documentPersistence";
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
import { syncRemoteDocumentResultFromResponse } from "./syncResponseResult";
import { traceHealed } from "./syncTrace";

export {
  buildDocumentSyncPlan,
  signDocumentOutgoingUpdate,
} from "./syncPlanIdentity";

import { buildMaterializedDocumentSyncPlan } from "./syncPlanMaterial";

export { buildMaterializedDocumentSyncPlan };

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
): void {
  if (materializedPlan.healedStaleContentKeyBundle) {
    input.apiClient.evictDocumentWriterProjection?.(input.documentId);
  }
}

function submittedDocumentSyncResult(input: {
  materializedPlan: MaterializedDocumentSyncPlan;
  recoveryPendingUpdatesById: ReadonlyMap<string, PendingUpdateRecord>;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  response: DocumentSyncResponse;
  sync: SyncRemoteDocumentInput;
  writerProjection: DocumentWriterProjectionResponse;
}): Promise<SyncRemoteDocumentResult> {
  evictHealedWriterProjection(input.sync, input.materializedPlan);
  if (input.materializedPlan.healedStaleContentKeyBundle) {
    traceHealed(input.sync.onSyncTrace, {
      accepted: input.response.acceptedOutgoingUpdateIds.length,
      documentId: input.materializedPlan.plan.documentId,
      epoch: input.materializedPlan.plan.contentKeyEpoch,
    });
  }
  return syncRemoteDocumentResultFromResponse({
    ...projectionVerificationOptions(input.sync),
    execSql: input.sync.execSql,
    materializedPlan: input.materializedPlan,
    onTerminalSubmitFailure: input.sync.onTerminalSubmitFailure,
    recoveryPendingUpdatesById: input.recoveryPendingUpdatesById,
    rekeyPendingUpdate: input.sync.rekeyPendingUpdate,
    resolveWriterPublicKey: input.sync.resolveWriterPublicKey,
    response: input.response,
    targetSecretKey: input.sync.targetSecretKey,
    writerProjection: input.writerProjection,
    writerPublicKeysByFingerprint: input.sync.writerPublicKeysByFingerprint,
    resolveProjectionUserKey: input.resolveProjectionUserKey,
  });
}

function buildRemoteDocumentSyncPlan(input: {
  pendingUpdates: readonly PendingUpdateRecord[];
  projection: DocumentWriterProjectionResponse;
  regenerateQueuedCheckpoints: boolean;
  sync: SyncRemoteDocumentInput;
}) {
  return buildMaterializedDocumentSyncPlan({
    author: input.sync.author,
    buildRotationSnapshot: input.sync.buildRotationSnapshot,
    execSql: input.sync.execSql,
    localVersionVector: input.sync.localVersionVector,
    minLsn: input.sync.minLsn,
    onSyncTrace: input.sync.onSyncTrace,
    pendingUpdates: input.pendingUpdates,
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

function submitPlannedSyncAttempt(args: {
  attempt: number;
  materializedPlan: MaterializedDocumentSyncPlan;
  maxAttempts: number;
  pendingUpdates: readonly PendingUpdateRecord[];
  regenerateQueuedCheckpoints: boolean;
  sync: SyncRemoteDocumentInput;
  writeBearing: boolean;
}) {
  return submitDocumentSyncAttemptIfAllowed({
    apiClient: args.sync.apiClient,
    attempt: args.attempt,
    canRegenerateQueuedCheckpoints: canRegenerateQueuedCheckpoints({
      materializedPlan: args.materializedPlan,
      pendingUpdates: args.pendingUpdates,
      regenerateQueuedCheckpoints: args.regenerateQueuedCheckpoints,
      sync: args.sync,
    }),
    documentId: args.sync.documentId,
    isRemoteSyncBlocked: args.sync.isRemoteSyncBlocked,
    maxAttempts: args.maxAttempts,
    onRemoteDocumentDeleted: args.sync.onRemoteDocumentDeleted,
    onSyncTrace: args.sync.onSyncTrace,
    onTerminalSubmitFailure: args.sync.onTerminalSubmitFailure,
    pendingUpdates: args.pendingUpdates,
    plan: args.materializedPlan.plan,
    writeBearing: args.writeBearing,
  });
}

/**
 * A write-bearing pass records through the submit handler (its queued writes
 * are what the failure blocks). A read-only pass records through the
 * revalidation handler so the refusal still leaves a durable trail instead
 * of silently never revalidating (edge-case row 13). `writeBearing` is the
 * pass's character, not the momentary array length: update-id recovery
 * empties the in-flight batch while the durable rows still exist, and that
 * retry must keep the submit classification (and its 403 handling).
 */
function projectionFailureHandler(
  input: SyncRemoteDocumentInput,
  writeBearing: boolean,
): TerminalSubmitFailureHandler | undefined {
  return writeBearing
    ? input.onTerminalSubmitFailure
    : input.onReadOnlyProjectionFailure;
}

function resolveAttemptProjection(
  input: SyncRemoteDocumentInput,
  writeBearing: boolean,
  reusableWriterProjection: DocumentWriterProjectionResponse | null,
) {
  return resolveSyncAttemptWriterProjection({
    apiClient: input.apiClient,
    documentId: input.documentId,
    onRemoteDocumentDeleted: input.onRemoteDocumentDeleted,
    onSyncAbandoned: input.onSyncAbandoned,
    onSyncTrace: input.onSyncTrace,
    onTerminalFailure: projectionFailureHandler(input, writeBearing),
    reusableWriterProjection,
  });
}

export async function syncRemoteDocument(
  input: SyncRemoteDocumentInput,
): Promise<SyncRemoteDocumentResult | null> {
  const resolveProjectionUserKey = requireProjectionUserKeyResolver(
    input.resolveProjectionUserKey,
    "Remote document sync",
  );
  const maxAttempts = input.apiClient.syncDocumentResult ? 3 : 1;
  let pendingUpdates = input.pendingUpdates ?? [];
  let recoveryPendingUpdatesById = new Map<string, PendingUpdateRecord>();
  let regenerateQueuedCheckpoints = false;
  let reusableWriterProjection = input.writerProjection ?? null;

  const persistedSync = await tryPersistedReadOnlyDocumentSync(
    input,
    resolveProjectionUserKey,
  );
  if (persistedSync?.kind === "completed") {
    return persistedSync.result;
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const writeBearing =
      pendingUpdates.length > 0 || recoveryPendingUpdatesById.size > 0;
    const writerProjection = await resolveAttemptProjection(
      input,
      writeBearing,
      reusableWriterProjection,
    );
    reusableWriterProjection = null;
    if (!writerProjection) {
      return null;
    }
    const planned = await retrySyncPlanOrAbandon({
      apiClient: input.apiClient,
      buildWithProjection: (projection) =>
        buildRemoteDocumentSyncPlan({
          pendingUpdates,
          projection,
          regenerateQueuedCheckpoints,
          sync: input,
        }),
      documentId: input.documentId,
      onRemoteDocumentDeleted: input.onRemoteDocumentDeleted,
      onSyncAbandoned: input.onSyncAbandoned,
      onSyncTrace: input.onSyncTrace,
      onTerminalFailure: projectionFailureHandler(input, writeBearing),
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
      pendingUpdates,
      regenerateQueuedCheckpoints,
      sync: input,
      writeBearing,
    });
    if (submitted === "retry") {
      evictStaleProjectionForRetry(input);
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
      recoveryPendingUpdatesById,
      resolveProjectionUserKey,
      response: submitted.response,
      sync: input,
      writerProjection: plannedWriterProjection,
    });
  }

  input.onSyncAbandoned?.("every sync attempt hit a retryable conflict");
  return null;
}

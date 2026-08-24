import {
  encodeVersionVector,
  exportFullHistorySnapshot,
  importUpdates,
} from "@symcrypt/loro";
import type { DocumentWriterProjectionResponse } from "@symcrypt/validators/response";
import { readPullContinuation } from "../../data/documents/shared/syncPagination";
import type { ProjectionUserKeyResolver } from "../../data/keyingProjectionVerification";
import { isKeyingVerificationError } from "../../data/keyingProjectionVerification/error";
import { isPrincipalPolicyNotCachedError } from "../../data/keyingProjectionVerification/principalPolicyVerification";
import {
  CONTAINER_METADATA_APP_KIND,
  type ContainerContentsPersistence,
} from "../../data/persistence/container-contents/containerContentsPersistence";
import {
  clearDocumentSyncFailure,
  type DocumentRecord,
  type PendingUpdateRecord,
  recordDocumentSyncFailure,
} from "../../data/sqlite/documentPersistence";
import { settleOutgoingPassAndDecideReArm } from "../../data/sync/outgoingUpdateSettlement";
import {
  createDocumentWriterPublicKeyResolver,
  describeDocumentSyncSubmitFailure,
  type RekeyPendingUpdate,
  resolveDocumentCreateAuthor,
  shouldClearDocumentSyncFailureAfterPass,
  syncRemoteDocument,
} from "../documents";
import { createRuntimePrincipalPolicyWarmer } from "../principals/runtimePolicyWarmer";
import {
  createReadOnlyMetadataSyncSaveOptions,
  hasCurrentContainerMetadataReadState,
  persistContainerMetadataStateFromRuntime,
} from "./metadataPersistence";

export {
  hasContainerMetadataDocumentUpdateEvent,
  listContainerMetadataDocumentUpdateIds,
} from "./metadataEvents";
export {
  persistContainerMetadataStateFromRuntime,
  renameContainerMetadataStateFromRuntime,
  setContainerIconMetadataStateFromRuntime,
} from "./metadataPersistence";

import type {
  ContainerMetadataState,
  SyncedContainerMetadataState,
} from "./metadataTypes";

export type { ContainerMetadataPatch } from "./metadataTypes";

import type { ContainerContentsWorkflowRuntime } from "./runtime";

type ContainerMetadataSyncApi = Parameters<
  typeof syncRemoteDocument
>[0]["apiClient"] &
  Pick<
    ContainerContentsWorkflowRuntime["apiClient"],
    "getCurrentPrincipalPolicy"
  >;

interface ContainerMetadataSyncRuntime
  extends Pick<
    ContainerContentsWorkflowRuntime,
    | "auth"
    | "crypto"
    | "infra"
    | "resolveTrustedUserIdentity"
    | "state"
    | "util"
  > {
  apiClient: ContainerMetadataSyncApi;
}

type ContainerMetadataSyncResult = NonNullable<
  Awaited<ReturnType<typeof syncRemoteDocument>>
>;

interface ContainerMetadataSyncAttempt {
  outgoingUpdateCount: number;
  synced: ContainerMetadataSyncResult;
}

export function settleContainerMetadataOutgoingPass(
  metadataState: ContainerMetadataState,
  attempt: ContainerMetadataSyncAttempt,
): boolean {
  const shouldReArmOutgoing = settleOutgoingPassAndDecideReArm(metadataState, {
    exhaustedPendingUpdateCount: attempt.synced.exhaustedPendingUpdateCount,
    outgoingUpdateCount: attempt.outgoingUpdateCount,
    rekeyedUpdateCount: attempt.synced.rekeyedPendingUpdateIds.length,
    settledUpdateCount: attempt.synced.settledPendingUpdateIds.length,
    acceptedRecoveryBaseline: attempt.synced.acceptedRecoveryBaseline,
  });
  return (
    attempt.synced.hasDeferredPendingUpdates ||
    shouldReArmOutgoing ||
    attempt.synced.hasIncompletePull
  );
}

function isStaleContainerMetadataSecurityStateError(error: unknown): boolean {
  // Signed-state verification failures are terminal integrity incidents, even
  // when their diagnostic message resembles an ordinary stale-key condition.
  if (isKeyingVerificationError(error)) return false;
  const message = error instanceof Error ? error.message : "";

  return (
    message.startsWith(
      "Document authorizing container KEK path could not be unwrapped",
    ) ||
    message.startsWith("Document content key could not be unwrapped") ||
    message.startsWith("Document content-key bundle is stale") ||
    message.startsWith("Document content-key re-wrap KEK is unavailable") ||
    message.startsWith("Document stale-bundle recovery") ||
    message === "Document sync target hash mismatch" ||
    message === "Document sync content-key targets mismatch"
  );
}

interface SyncRemoteContainerMetadataInput {
  buildRotationSnapshot?: (() => Promise<Uint8Array | null>) | undefined;
  containerId: string;
  documentId: string | null;
  lastCommitLsn?: string | null | undefined;
  localVersionVector: string | null;
  onOutgoingUpdatesMaterialized?:
    | ((updateIds: readonly string[]) => void)
    | undefined;
  onPullContinuationInvalidated?: (() => void) | undefined;
  pendingUpdates: readonly PendingUpdateRecord[];
  persistedState?: DocumentRecord | null | undefined;
  pullContinuation?: ContainerMetadataState["pullContinuation"];
  rekeyPendingUpdate: RekeyPendingUpdate;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ContainerMetadataSyncRuntime;
  targetSecretKey: Uint8Array;
  writerProjection?: DocumentWriterProjectionResponse | undefined;
}

async function syncRemoteContainerMetadata(
  input: SyncRemoteContainerMetadataInput,
): Promise<ContainerMetadataSyncAttempt | null> {
  const {
    buildRotationSnapshot,
    containerId,
    documentId,
    lastCommitLsn,
    localVersionVector,
    onOutgoingUpdatesMaterialized,
    pendingUpdates,
    persistedState,
    rekeyPendingUpdate,
    resolveProjectionUserKey,
    runtime,
    targetSecretKey,
    writerProjection,
  } = input;
  const execSql = runtime.infra.execSql;

  if (!documentId) {
    return null;
  }

  const author = resolveDocumentCreateAuthor(runtime);
  if (!author) {
    runtime.util.log(
      "Container contents: skipped metadata sync because the writer context is unavailable.",
    );
    return null;
  }

  const metadataScope = {
    appKind: CONTAINER_METADATA_APP_KIND,
    localId: containerId,
  };
  const synced = await syncRemoteDocument({
    apiClient: runtime.apiClient,
    author,
    buildRotationSnapshot,
    documentId,
    execSql,
    isRemoteSyncBlocked: runtime.util.isRemoteSyncBlocked,
    localVersionVector,
    minLsn: lastCommitLsn ?? undefined,
    onOutgoingUpdatesMaterialized,
    onPullContinuationInvalidated: input.onPullContinuationInvalidated,
    onSyncTrace: (line) => runtime.util.log(`Container contents: ${line}`),
    onTerminalSubmitFailure: (failure) =>
      recordDocumentSyncFailure(execSql, metadataScope, {
        attemptedAt: new Date().toISOString(),
        message: describeDocumentSyncSubmitFailure(failure),
        status: failure.status,
      }),
    pendingUpdates,
    persistedState,
    pullContinuation: input.pullContinuation ?? undefined,
    rekeyPendingUpdate,
    resolveProjectionUserKey,
    resolveWriterPublicKey: createDocumentWriterPublicKeyResolver({
      logPrefix: "Container contents",
      runtime,
      writerKeyLabel: "metadata writer key",
    }),
    targetSecretKey,
    warmReferencedPrincipalPolicies:
      createRuntimePrincipalPolicyWarmer(runtime),
    writerProjection,
  }).catch((error: unknown) => {
    if (isStaleContainerMetadataSecurityStateError(error)) {
      runtime.util.log(
        `Container contents: deferred metadata sync for ${containerId} because its content-key targets are stale.`,
      );
      return null;
    }

    // A cold principal-policy cache is transient: warming already ran and
    // failed within this attempt, and a null return leaves the container's
    // needing-sync/read state unsettled, so the next lane trigger retries it.
    // Deferring per container keeps one cold policy from failing the whole
    // structural pass (and from counting as a lane failure).
    if (isPrincipalPolicyNotCachedError(error)) {
      runtime.util.log(
        `Container contents: deferred metadata sync for ${containerId} because a referenced principal policy is not cached yet.`,
      );
      return null;
    }

    throw error;
  });
  if (!synced) {
    return null;
  }

  // The pass submitted successfully, so any recorded terminal failure for this
  // container's metadata document no longer describes reality — unless the
  // pass itself just recorded one for re-key-exhausted updates.
  if (shouldClearDocumentSyncFailureAfterPass(synced, pendingUpdates.length)) {
    await clearDocumentSyncFailure(execSql, metadataScope);
  }

  return {
    outgoingUpdateCount: pendingUpdates.length,
    synced,
  };
}

function documentWriterProjectionMatchesMetadataSyncResponse(
  writerProjection: DocumentWriterProjectionResponse,
  synced: ContainerMetadataSyncAttempt["synced"],
): boolean {
  return (
    writerProjection.contentKeyBundle.contentKeyEpoch ===
      synced.response.contentKeyBundle.contentKeyEpoch &&
    writerProjection.contentKeyBundle.linkSetManifestHash ===
      synced.response.contentKeyBundle.linkSetManifestHash &&
    writerProjection.contentKeyBundle.targetHash ===
      synced.response.contentKeyBundle.targetHash &&
    writerProjection.documentKekTargets.linkSetManifestHash ===
      synced.response.documentKekTargets.linkSetManifestHash &&
    writerProjection.documentKekTargets.documentKeyTargetHash ===
      synced.response.documentKekTargets.documentKeyTargetHash
  );
}

function resolveSyncedContainerMetadataWriterProjection(
  metadataState: ContainerMetadataState,
  synced: ContainerMetadataSyncAttempt["synced"],
): DocumentWriterProjectionResponse | null {
  const writerProjection =
    synced.writerProjection ??
    (metadataState.metadataWriterProjection?.documentId ===
    synced.plan.documentId
      ? metadataState.metadataWriterProjection
      : null);
  return writerProjection &&
    documentWriterProjectionMatchesMetadataSyncResponse(
      writerProjection,
      synced,
    )
    ? writerProjection
    : null;
}

/**
 * Heals a stale metadata content-key bundle by rotating to a fresh content
 * key anchored by this full-history snapshot.
 */
function metadataRotationSnapshotProvider(
  metadataState: ContainerMetadataState,
): () => Promise<Uint8Array | null> {
  return async () => exportFullHistorySnapshot(metadataState.doc);
}

interface SyncContainerMetadataStateInput {
  forceReadSync?: boolean | undefined;
  /**
   * Self-echo registry shared with {@link listContainerMetadataDocumentUpdateIds}:
   * update ids this pass is about to send are registered BEFORE the network
   * await so the author's own `document_update_created` echo — which can land
   * before the response is processed — is classified as self-authored and never
   * arms a redundant forced read-sync.
   */
  locallyAcceptedUpdateIds?: Set<string> | undefined;
  metadataState: ContainerMetadataState;
  persistence: ContainerContentsPersistence;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ContainerMetadataSyncRuntime;
  targetSecretKey: Uint8Array;
}

export async function syncContainerMetadataState(
  input: SyncContainerMetadataStateInput,
): Promise<SyncedContainerMetadataState | null> {
  const {
    metadataState,
    persistence,
    resolveProjectionUserKey,
    runtime,
    targetSecretKey,
  } = input;
  const { documentId } = metadataState.record;
  if (!documentId) {
    return null;
  }
  const execSql = runtime.infra.execSql;

  const pendingUpdates = await persistence.listPendingUpdates(
    execSql,
    metadataState.container.id,
  );
  if (
    pendingUpdates.length === 0 &&
    metadataState.pullContinuation == null &&
    !input.forceReadSync &&
    hasCurrentContainerMetadataReadState(metadataState.record)
  ) {
    return null;
  }

  // Register only the exact signed batches as they are materialized, before
  // each network await. Bounded batching and recovery can omit queued ids or
  // introduce a synthetic baseline that was never present in the queue.
  const sentUpdateIds: string[] = [];

  const syncAttempt = await cleanupContainerMetadataRegistrationsOnFailure(
    input.locallyAcceptedUpdateIds,
    sentUpdateIds,
    () =>
      syncRemoteContainerMetadata({
        buildRotationSnapshot: metadataRotationSnapshotProvider(metadataState),
        containerId: metadataState.container.id,
        documentId,
        lastCommitLsn: metadataState.record.lastCommitLsn,
        localVersionVector: encodeVersionVector(metadataState.doc),
        onOutgoingUpdatesMaterialized: (updateIds) =>
          preRegisterMaterializedContainerMetadataUpdateIds(
            input.locallyAcceptedUpdateIds,
            sentUpdateIds,
            updateIds,
          ),
        onPullContinuationInvalidated: () => {
          metadataState.pullContinuation = null;
        },
        pendingUpdates,
        persistedState: metadataState.record,
        pullContinuation: metadataState.pullContinuation ?? undefined,
        rekeyPendingUpdate: persistence.rekeyPendingUpdate,
        resolveProjectionUserKey,
        runtime,
        targetSecretKey,
        writerProjection:
          metadataState.metadataWriterProjection?.documentId === documentId
            ? metadataState.metadataWriterProjection
            : undefined,
      }),
  );
  if (!syncAttempt) {
    return null;
  }
  return finalizeContainerMetadataSync({
    documentId,
    locallyAcceptedUpdateIds: input.locallyAcceptedUpdateIds,
    metadataState,
    persistence,
    runtime,
    sentUpdateIds,
    syncAttempt,
  });
}

export function preRegisterMaterializedContainerMetadataUpdateIds(
  locallyAcceptedUpdateIds: Set<string> | undefined,
  registeredUpdateIds: string[],
  materializedUpdateIds: readonly string[],
): void {
  const alreadyRegistered = new Set(registeredUpdateIds);
  for (const updateId of materializedUpdateIds) {
    if (alreadyRegistered.has(updateId)) continue;
    alreadyRegistered.add(updateId);
    registeredUpdateIds.push(updateId);
    locallyAcceptedUpdateIds?.add(updateId);
  }
}

function discardUnacceptedContainerMetadataUpdateIds(
  locallyAcceptedUpdateIds: Set<string> | undefined,
  sentUpdateIds: readonly string[],
  acceptedUpdateIds: readonly string[],
): void {
  if (!locallyAcceptedUpdateIds) return;
  const acceptedOutgoing = new Set(acceptedUpdateIds);
  for (const sentUpdateId of sentUpdateIds) {
    if (!acceptedOutgoing.has(sentUpdateId)) {
      locallyAcceptedUpdateIds.delete(sentUpdateId);
    }
  }
}

export async function cleanupContainerMetadataRegistrationsOnFailure<T>(
  locallyAcceptedUpdateIds: Set<string> | undefined,
  sentUpdateIds: readonly string[],
  task: () => Promise<T | null>,
): Promise<T | null> {
  try {
    const result = await task();
    if (result === null) {
      discardUnacceptedContainerMetadataUpdateIds(
        locallyAcceptedUpdateIds,
        sentUpdateIds,
        [],
      );
    }
    return result;
  } catch (error) {
    discardUnacceptedContainerMetadataUpdateIds(
      locallyAcceptedUpdateIds,
      sentUpdateIds,
      [],
    );
    throw error;
  }
}

async function finalizeContainerMetadataSync(input: {
  documentId: string;
  locallyAcceptedUpdateIds: Set<string> | undefined;
  metadataState: ContainerMetadataState;
  persistence: ContainerContentsPersistence;
  runtime: ContainerMetadataSyncRuntime;
  sentUpdateIds: readonly string[];
  syncAttempt: ContainerMetadataSyncAttempt;
}): Promise<SyncedContainerMetadataState> {
  const { metadataState, syncAttempt } = input;
  const { outgoingUpdateCount, synced } = syncAttempt;
  // An id sent but not accepted will never be echoed. Accepted ids stay
  // registered until their realtime echo consumes them.
  discardUnacceptedContainerMetadataUpdateIds(
    input.locallyAcceptedUpdateIds,
    input.sentUpdateIds,
    synced.response.acceptedOutgoingUpdateIds,
  );
  metadataState.metadataWriterProjection =
    resolveSyncedContainerMetadataWriterProjection(metadataState, synced);
  if (synced.decryptedUpdates.length > 0) {
    importUpdates(
      metadataState.doc,
      synced.decryptedUpdates.map((update) => update.updateData),
    );
  }

  const persisted = await persistContainerMetadataStateFromRuntime({
    acceptedPendingUpdateIds: synced.settledPendingUpdateIds,
    metadataState,
    patch: {
      ...synced.persistedState,
      documentId: input.documentId,
      lastCommitLsn:
        synced.response.commitLsn ?? metadataState.record.lastCommitLsn ?? null,
      metadataDocumentId: input.documentId,
    },
    persistence: input.persistence,
    runtime: input.runtime,
    saveOptions:
      outgoingUpdateCount === 0
        ? createReadOnlyMetadataSyncSaveOptions()
        : undefined,
  });
  metadataState.pullContinuation = readPullContinuation(synced.response);

  return {
    ...persisted,
    shouldRequestFollowupSync: settleContainerMetadataOutgoingPass(
      metadataState,
      syncAttempt,
    ),
  };
}

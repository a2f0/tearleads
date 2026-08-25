import {
  encodeVersionVector,
  exportFullHistorySnapshot,
  importUpdates,
} from "@symcrypt/loro";
import type { DocumentWriterProjectionResponse } from "@symcrypt/validators/response";
import { readPullContinuation } from "../../data/documents/shared/syncPagination";
import type { ProjectionUserKeyResolver } from "../../data/keyingProjectionVerification";
import {
  CONTAINER_METADATA_APP_KIND,
  type ContainerContentsPersistence,
} from "../../data/persistence/container-contents/containerContentsPersistence";
import {
  clearDocumentSyncFailure,
  type PendingUpdateRecord,
  recordDocumentSyncFailure,
} from "../../data/sqlite/documentPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
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
  currentMetadataPullContinuation,
  hasCurrentContainerMetadataReadState,
  installContainerMetadataRecord,
  persistContainerMetadataStateFromRuntime,
} from "./metadataPersistence";
import { deferRecoverableMetadataSyncError } from "./metadataSyncErrors";
import { shouldRequestContainerMetadataFollowup } from "./metadataSyncFollowup";

export {
  hasContainerMetadataDocumentUpdateEvent,
  listContainerMetadataDocumentUpdateIds,
} from "./metadataEvents";
export {
  installContainerMetadataRecord,
  persistContainerMetadataStateFromRuntime,
  renameContainerMetadataStateFromRuntime,
  setContainerIconMetadataStateFromRuntime,
} from "./metadataPersistence";

import { invalidateContainerMetadataPullContinuation } from "./metadataPullContinuationInvalidation";
import {
  cleanupContainerMetadataRegistrationsOnFailure,
  discardUnacceptedContainerMetadataUpdateIds,
  preRegisterMaterializedContainerMetadataUpdateIds,
} from "./metadataSyncRegistrations";
import type {
  ContainerMetadataState,
  MissingContainerMetadataState,
  SyncedContainerMetadataState,
} from "./metadataTypes";

export {
  cleanupContainerMetadataRegistrationsOnFailure,
  preRegisterMaterializedContainerMetadataUpdateIds,
} from "./metadataSyncRegistrations";
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
  consumedPullContinuation: ContainerMetadataState["pullContinuation"];
  outgoingUpdateCount: number;
  requestRecord: ContainerMetadataState["record"];
  synced: ContainerMetadataSyncResult;
}

function createContainerMetadataSyncAttempt(input: {
  outgoingUpdateCount: number;
  requestedPullContinuation: ContainerMetadataState["pullContinuation"];
  requestRecord: ContainerMetadataState["record"];
  synced: ContainerMetadataSyncResult;
}): ContainerMetadataSyncAttempt {
  return {
    consumedPullContinuation:
      input.synced.plan.request.pullCursor === undefined
        ? null
        : (input.requestedPullContinuation ?? null),
    outgoingUpdateCount: input.outgoingUpdateCount,
    requestRecord: input.requestRecord,
    synced: input.synced,
  };
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

interface SyncRemoteContainerMetadataInput {
  buildRotationSnapshot?: (() => Promise<Uint8Array | null>) | undefined;
  containerId: string;
  documentId: string | null;
  lastCommitLsn?: string | null | undefined;
  localVersionVector: string | null;
  onOutgoingUpdatesMaterialized?:
    | ((updateIds: readonly string[]) => void)
    | undefined;
  onPullContinuationInvalidated?: Parameters<
    typeof syncRemoteDocument
  >[0]["onPullContinuationInvalidated"];
  pendingUpdates: readonly PendingUpdateRecord[];
  persistedState: ContainerMetadataState["record"];
  pullContinuation?: ContainerMetadataState["pullContinuation"];
  rekeyPendingUpdate: RekeyPendingUpdate;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ContainerMetadataSyncRuntime;
  targetSecretKey: Uint8Array;
  writerProjection?: DocumentWriterProjectionResponse | undefined;
}

async function clearSuccessfulMetadataSyncFailure(input: {
  execSql: ExecSql;
  metadataScope: { appKind: string; localId: string };
  pendingUpdateCount: number;
  synced: ContainerMetadataSyncResult;
}): Promise<void> {
  if (
    shouldClearDocumentSyncFailureAfterPass(
      input.synced,
      input.pendingUpdateCount,
    )
  ) {
    await clearDocumentSyncFailure(input.execSql, input.metadataScope);
  }
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
  }).catch((error: unknown) =>
    deferRecoverableMetadataSyncError({ containerId, error, runtime }),
  );
  if (!synced) {
    return null;
  }

  await clearSuccessfulMetadataSyncFailure({
    execSql,
    metadataScope,
    pendingUpdateCount: pendingUpdates.length,
    synced,
  });

  return createContainerMetadataSyncAttempt({
    outgoingUpdateCount: pendingUpdates.length,
    requestedPullContinuation: input.pullContinuation,
    requestRecord: persistedState,
    synced,
  });
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
   * Register sent ids before the network await so early self echoes cannot arm
   * a redundant read-sync. Shared with {@link listContainerMetadataDocumentUpdateIds}.
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
): Promise<
  SyncedContainerMetadataState | MissingContainerMetadataState | null
> {
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
    currentMetadataPullContinuation(metadataState) === null &&
    !metadataState.record.pullContinuationRecoveryRequired &&
    !input.forceReadSync &&
    hasCurrentContainerMetadataReadState(metadataState.record)
  ) {
    return null;
  }

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
        onPullContinuationInvalidated: (continuation) =>
          invalidateContainerMetadataPullContinuation({
            continuation,
            metadataState,
            persistence,
            runtime,
          }),
        pendingUpdates,
        persistedState: metadataState.record,
        pullContinuation:
          currentMetadataPullContinuation(metadataState) ?? undefined,
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

async function finalizeContainerMetadataSync(input: {
  documentId: string;
  locallyAcceptedUpdateIds: Set<string> | undefined;
  metadataState: ContainerMetadataState;
  persistence: ContainerContentsPersistence;
  runtime: ContainerMetadataSyncRuntime;
  sentUpdateIds: readonly string[];
  syncAttempt: ContainerMetadataSyncAttempt;
}): Promise<SyncedContainerMetadataState | MissingContainerMetadataState> {
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
    expectedSyncState: {
      pullContinuation: syncAttempt.consumedPullContinuation ?? null,
      record: syncAttempt.requestRecord,
    },
    metadataState,
    patch: {
      ...synced.persistedState,
      documentId: input.documentId,
      lastCommitLsn:
        synced.response.commitLsn ?? metadataState.record.lastCommitLsn ?? null,
      metadataDocumentId: input.documentId,
      pullContinuation: readPullContinuation(synced.response),
    },
    persistence: input.persistence,
    runtime: input.runtime,
    saveOptions:
      outgoingUpdateCount === 0
        ? createReadOnlyMetadataSyncSaveOptions()
        : undefined,
  });
  if (!persisted) {
    discardUnacceptedContainerMetadataUpdateIds(
      input.locallyAcceptedUpdateIds,
      input.sentUpdateIds,
      [],
    );
    metadataState.metadataWriterProjection = null;
    return { missing: true };
  }
  installContainerMetadataRecord(metadataState, persisted.record);
  if (persisted.pullContinuationSuperseded) {
    // The response's accepted IDs were not durably settled. Treat every
    // pre-registration as unapplied so an early echo cannot hide work that the
    // forced follow-up still needs to reconcile.
    discardUnacceptedContainerMetadataUpdateIds(
      input.locallyAcceptedUpdateIds,
      input.sentUpdateIds,
      [],
    );
    metadataState.metadataWriterProjection = null;
  }

  return {
    ...persisted,
    shouldRequestFollowupSync: shouldRequestContainerMetadataFollowup({
      persisted,
      settleOutgoingPass: () =>
        settleContainerMetadataOutgoingPass(metadataState, syncAttempt),
    }),
  };
}

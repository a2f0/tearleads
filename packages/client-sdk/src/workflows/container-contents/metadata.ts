import { encodeVersionVector, exportFullHistorySnapshot } from "@symcrypt/loro";
import type { DocumentWriterProjectionResponse } from "@symcrypt/validators/response";
import { readPullContinuation } from "../../data/documents/shared/syncPagination";
import type { ProjectionUserKeyResolver } from "../../data/keyingProjectionVerification";
import type { ContainerContentsPersistence } from "../../data/persistence/container-contents/containerContentsPersistence";
import type { PendingUpdateRecord } from "../../data/sqlite/documentPersistence";
import { settleOutgoingPassAndDecideReArm } from "../../data/sync/outgoingUpdateSettlement";
import { shouldClearDocumentSyncFailureAfterPass } from "../documents";
import { applyIncomingContainerMetadataUpdates } from "./metadataIncomingUpdateIsolation";
import {
  createReadOnlyMetadataSyncSaveOptions,
  currentMetadataPullContinuation,
  hasCurrentContainerMetadataReadState,
  installContainerMetadataRecord,
  persistContainerMetadataStateFromRuntime,
} from "./metadataPersistence";
import {
  type ContainerMetadataSyncAttempt,
  type ContainerMetadataSyncRuntime,
  syncRemoteContainerMetadata,
} from "./metadataRemoteSync";
import {
  createDetachedContainerMetadataState,
  installDetachedContainerMetadataState,
} from "./metadataStateIsolation";
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
  isCurrent: () => boolean;
  /**
   * Register sent ids before the network await so early self echoes cannot arm
   * a redundant read-sync. Shared with {@link listContainerMetadataDocumentUpdateIds}.
   */
  locallyAcceptedUpdateIds?: Set<string> | undefined;
  metadataState: ContainerMetadataState;
  onDurableStateNeedsReload?: (() => void) | undefined;
  persistence: ContainerContentsPersistence;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ContainerMetadataSyncRuntime;
  targetSecretKey: Uint8Array;
}

async function requestContainerMetadataSync(input: {
  documentId: string;
  metadataState: ContainerMetadataState;
  pendingUpdates: readonly PendingUpdateRecord[];
  sentUpdateIds: string[];
  syncInput: SyncContainerMetadataStateInput;
}): Promise<ContainerMetadataSyncAttempt | null> {
  const { metadataState, sentUpdateIds, syncInput } = input;
  const { isCurrent, persistence, runtime } = syncInput;
  return cleanupContainerMetadataRegistrationsOnFailure(
    syncInput.locallyAcceptedUpdateIds,
    sentUpdateIds,
    () =>
      syncRemoteContainerMetadata({
        buildRotationSnapshot: metadataRotationSnapshotProvider(metadataState),
        containerId: metadataState.container.id,
        currentDocument: metadataState.doc,
        documentId: input.documentId,
        isCurrent,
        lastCommitLsn: metadataState.record.lastCommitLsn,
        localVersionVector: encodeVersionVector(metadataState.doc),
        onOutgoingUpdatesMaterialized: (updateIds) => {
          if (isCurrent()) {
            preRegisterMaterializedContainerMetadataUpdateIds(
              syncInput.locallyAcceptedUpdateIds,
              sentUpdateIds,
              updateIds,
            );
          }
        },
        onPullContinuationInvalidated: (continuation) =>
          invalidateContainerMetadataPullContinuation({
            continuation,
            isCurrent,
            metadataState,
            persistence,
            runtime,
          }),
        pendingUpdates: input.pendingUpdates,
        persistedState: metadataState.record,
        pullContinuation:
          currentMetadataPullContinuation(metadataState) ?? undefined,
        rekeyPendingUpdate: persistence.rekeyPendingUpdate,
        resolveProjectionUserKey: syncInput.resolveProjectionUserKey,
        runtime,
        targetSecretKey: syncInput.targetSecretKey,
        writerProjection:
          metadataState.metadataWriterProjection?.documentId ===
          input.documentId
            ? metadataState.metadataWriterProjection
            : undefined,
      }),
  );
}

export async function syncContainerMetadataState(
  input: SyncContainerMetadataStateInput,
): Promise<
  SyncedContainerMetadataState | MissingContainerMetadataState | null
> {
  const { persistence, runtime } = input;
  const liveMetadataState = input.metadataState;
  const { isCurrent } = input;
  if (!isCurrent()) {
    return null;
  }
  const { documentId } = liveMetadataState.record;
  if (!documentId) {
    return null;
  }
  const execSql = runtime.infra.execSql;

  const pendingUpdates = await persistence.listPendingUpdates(
    execSql,
    liveMetadataState.container.id,
  );
  if (!isCurrent()) {
    return null;
  }
  if (
    pendingUpdates.length === 0 &&
    currentMetadataPullContinuation(liveMetadataState) === null &&
    !liveMetadataState.record.pullContinuationRecoveryRequired &&
    !input.forceReadSync &&
    hasCurrentContainerMetadataReadState(liveMetadataState.record)
  ) {
    return null;
  }
  const metadataState =
    await createDetachedContainerMetadataState(liveMetadataState);
  if (!isCurrent()) {
    return null;
  }

  const sentUpdateIds: string[] = [];

  const syncAttempt = await requestContainerMetadataSync({
    documentId,
    metadataState,
    pendingUpdates,
    sentUpdateIds,
    syncInput: input,
  });
  if (!syncAttempt) {
    return null;
  }
  if (!isCurrent()) {
    discardUnacceptedContainerMetadataUpdateIds(
      input.locallyAcceptedUpdateIds,
      sentUpdateIds,
      [],
    );
    return null;
  }
  const finalized = await finalizeContainerMetadataSync({
    documentId,
    isCurrent,
    locallyAcceptedUpdateIds: input.locallyAcceptedUpdateIds,
    metadataState,
    onDurableStateNeedsReload: input.onDurableStateNeedsReload,
    persistence,
    runtime,
    sentUpdateIds,
    syncAttempt,
  });
  if (!isCurrent() || !finalized) {
    return null;
  }
  if (!("missing" in finalized)) {
    installDetachedContainerMetadataState(liveMetadataState, metadataState, {
      preserveConcurrentMetadataEdit: true,
    });
  }
  return finalized;
}

async function finalizeContainerMetadataSync(input: {
  documentId: string;
  isCurrent: () => boolean;
  locallyAcceptedUpdateIds: Set<string> | undefined;
  metadataState: ContainerMetadataState;
  onDurableStateNeedsReload?: (() => void) | undefined;
  persistence: ContainerContentsPersistence;
  runtime: ContainerMetadataSyncRuntime;
  sentUpdateIds: readonly string[];
  syncAttempt: ContainerMetadataSyncAttempt;
}): Promise<
  SyncedContainerMetadataState | MissingContainerMetadataState | null
> {
  const { metadataState, syncAttempt } = input;
  const { outgoingUpdateCount, synced } = syncAttempt;
  if (!input.isCurrent()) {
    discardUnacceptedContainerMetadataUpdateIds(
      input.locallyAcceptedUpdateIds,
      input.sentUpdateIds,
      [],
    );
    return null;
  }
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
    applyIncomingContainerMetadataUpdates(metadataState.doc, synced);
  }
  const persisted = await persistContainerMetadataStateFromRuntime({
    acceptedPendingUpdateIds: synced.settledPendingUpdateIds,
    clearSyncFailure: shouldClearDocumentSyncFailureAfterPass(
      synced,
      outgoingUpdateCount,
    ),
    expectedSyncState: {
      pullContinuation: syncAttempt.consumedPullContinuation ?? null,
      record: syncAttempt.requestRecord,
    },
    metadataState,
    onDurableStateNeedsReload: input.onDurableStateNeedsReload,
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
    stillCurrent: input.isCurrent,
  });
  if (!input.isCurrent()) {
    discardUnacceptedContainerMetadataUpdateIds(
      input.locallyAcceptedUpdateIds,
      input.sentUpdateIds,
      [],
    );
    return null;
  }
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

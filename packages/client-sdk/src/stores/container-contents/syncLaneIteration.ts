import { syncPendingContainerCreateIntents } from "../../workflows/container-contents/container-state/createIntentSync";
import { syncPendingContainerMoveIntents } from "../../workflows/container-contents/container-state/moveIntentSync";
import {
  type DocumentMoveIntentSyncHost,
  syncPendingDocumentMoveIntents,
} from "../../workflows/container-contents/documentMoveIntentSync";
import {
  installContainerMetadataRecord,
  syncContainerMetadataState,
} from "../../workflows/container-contents/metadata";
import type {
  ContainerState,
  RemoteContainerHydrationHost,
} from "../../workflows/container-contents/remoteHydration";
import { createContainerContentsDocumentsRuntime } from "../../workflows/container-contents/runtime";
import { openDocumentStore, requestDomainDocumentSync } from "../documents";
import { primeStoreDocuments, recoverStoreStaleRoot } from "./documentRecovery";
import { runContainerDocumentWork } from "./documentWork";
import {
  clearMetadataSyncQueueIfUnchanged,
  readMetadataSyncSeq,
} from "./metadataSyncSignal";
import { removeMissingSyncedContainerState } from "./missingSyncedContainerState";
import type {
  ContainerContentsStoreRuntime,
  ContainerContentsStoreSyncState,
} from "./syncAgentTypes";

type ContainerContentsStorePrimeDocumentRuntime = ReturnType<
  typeof createContainerContentsDocumentsRuntime
>;

function requestContainerContentsStoreSync(
  state: ContainerContentsStoreSyncState,
) {
  state.syncLane?.requestSync();
}

function isRemoteSyncBlocked(
  state: ContainerContentsStoreSyncState,
  organizationId: string,
): boolean {
  return state.runtime.util.isRemoteSyncBlocked?.(organizationId) ?? false;
}

function createContainerContentsStoreDocumentMoveHost(
  state: ContainerContentsStoreSyncState,
): DocumentMoveIntentSyncHost<ContainerContentsStorePrimeDocumentRuntime> {
  return {
    documentWorkflowRuntime: (containerId) =>
      createContainerContentsDocumentsRuntime(state.runtime, containerId),
    openDocumentStore: ({ containerId, documentId, localId }) =>
      openDocumentStore(
        state.runtime.state.domainScope,
        localId,
        createContainerContentsDocumentsRuntime(state.runtime, containerId),
        documentId,
      ),
  };
}

async function syncSingleContainerMetadata(input: {
  host: RemoteContainerHydrationHost;
  isCurrent: () => boolean;
  state: ContainerContentsStoreSyncState;
  containerState: ContainerState;
  encapsulationKeyPair: NonNullable<
    ContainerContentsStoreRuntime["crypto"]["encapsulationKeyPair"]
  >;
}) {
  const { containerState, encapsulationKeyPair, host, isCurrent, state } =
    input;
  const metadataDocumentId = containerState.record.documentId;
  // Snapshot this signal before the GET so a mid-pass event survives clearing.
  const consumedSeqById = new Map<string, number>();
  if (typeof metadataDocumentId === "string") {
    consumedSeqById.set(
      metadataDocumentId,
      readMetadataSyncSeq(state.metadataSyncSignalSeqById, metadataDocumentId),
    );
  }
  const synced = await syncContainerMetadataState({
    forceReadSync:
      typeof metadataDocumentId === "string" &&
      state.metadataDocumentIdsNeedingSync.has(metadataDocumentId),
    locallyAcceptedUpdateIds: state.locallyAcceptedMetadataUpdateIds,
    metadataState: containerState,
    persistence: state.persistence,
    resolveProjectionUserKey: state.resolveProjectionUserKey,
    runtime: state.runtime,
    targetSecretKey: encapsulationKeyPair.secretKey,
  });
  if (!isCurrent() || !synced) {
    return;
  }
  if ("missing" in synced) {
    removeMissingSyncedContainerState(
      state,
      containerState,
      host.updateSnapshot,
    );
    return;
  }

  for (const id of [metadataDocumentId, synced.record.documentId]) {
    if (typeof id === "string") {
      clearMetadataSyncQueueIfUnchanged({
        consumedSeqById,
        id,
        needingSync: state.metadataDocumentIdsNeedingSync,
        seqById: state.metadataSyncSignalSeqById,
      });
    }
  }
  containerState.container = synced.container;
  installContainerMetadataRecord(containerState, synced.record);
  host.updateSnapshot();

  if (synced.shouldRequestFollowupSync) {
    requestContainerContentsStoreSync(state);
  }
}

export async function runContainerContentsStoreSyncIteration(input: {
  host: RemoteContainerHydrationHost;
  reconcileRestoredAccess: () => Promise<void>;
  state: ContainerContentsStoreSyncState;
}) {
  const { host, reconcileRestoredAccess, state } = input;
  const encapsulationKeyPair = state.runtime.crypto.encapsulationKeyPair;
  if (
    state.runtime.infra.dbStatus !== "ready" ||
    !state.snapshot.ready ||
    !state.runtime.state.online ||
    !state.runtime.auth.isAuthenticated ||
    !encapsulationKeyPair
  ) {
    return;
  }
  const lifecycleGeneration = state.lifecycleGeneration;
  const domainScope = state.runtime.state.domainScope;
  const execSql = state.runtime.infra.execSql;
  const resolveProjectionUserKey = state.resolveProjectionUserKey;
  const syncLane = state.syncLane;
  const isCurrent = () =>
    state.lifecycleGeneration === lifecycleGeneration &&
    state.runtime.state.domainScope === domainScope &&
    state.runtime.infra.execSql === execSql &&
    state.resolveProjectionUserKey === resolveProjectionUserKey &&
    state.syncLane === syncLane &&
    !syncLane?.isDisposed?.();

  await reconcileRestoredAccess();
  if (!isCurrent()) {
    return;
  }
  const isOrganizationBlocked = (organizationId: string) =>
    isRemoteSyncBlocked(state, organizationId);

  const createdContainerCount = await syncPendingContainerCreateIntents({
    host,
    isRemoteSyncBlocked: isOrganizationBlocked,
    state,
  });
  if (!isCurrent()) {
    return;
  }
  if (createdContainerCount > 0) {
    state.documentStoresNeedPriming = true;
    host.updateSnapshot();
  }

  const movedContainerCount = await syncPendingContainerMoveIntents({
    host,
    isRemoteSyncBlocked: isOrganizationBlocked,
    state,
  });
  if (!isCurrent()) {
    return;
  }
  if (movedContainerCount > 0) {
    state.documentStoresNeedPriming = true;
    host.updateSnapshot();
    requestDomainDocumentSync(state.runtime.state.domainScope);
    requestContainerContentsStoreSync(state);
  }

  for (const containerState of Array.from(state.containersById.values())) {
    await syncSingleContainerMetadata({
      containerState,
      encapsulationKeyPair,
      host,
      isCurrent,
      state,
    });
    if (!isCurrent()) {
      return;
    }
  }

  // Root adoption notifies session consumers synchronously. Let container
  // metadata converge first so a recovered system container is never exposed
  // under its placeholder name when the active root changes.
  await runContainerDocumentWork({
    onContextChanged: () => requestContainerContentsStoreSync(state),
    onDocumentsMoved: () => {
      requestDomainDocumentSync(state.runtime.state.domainScope);
      requestContainerContentsStoreSync(state);
    },
    primeDocuments: () => primeStoreDocuments(state),
    recoverStaleRoot: () => recoverStoreStaleRoot(state),
    shouldPrimeDocuments: () => state.documentStoresNeedPriming,
    // Document move intents live in the structural phase because they may
    // target containers created locally in the same session, such as Trash.
    // Root recovery rewrites stale endpoints and returns their intents to
    // pending, so replay follows recovery in this same pass.
    syncPendingDocumentMoves: () =>
      syncPendingDocumentMoveIntents({
        host: createContainerContentsStoreDocumentMoveHost(state),
        isRemoteSyncBlocked: isOrganizationBlocked,
        state,
      }),
  });
}

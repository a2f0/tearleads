import { syncPendingContainerCreateIntents } from "../../workflows/container-contents/container-state/createIntentSync";
import { syncPendingContainerMoveIntents } from "../../workflows/container-contents/container-state/moveIntentSync";
import {
  type DocumentMoveIntentSyncHost,
  syncPendingDocumentMoveIntents,
} from "../../workflows/container-contents/documentMoveIntentSync";
import { syncContainerMetadataState } from "../../workflows/container-contents/metadata";
import type {
  ContainerState,
  RemoteContainerHydrationHost,
} from "../../workflows/container-contents/remoteHydration";
import { createContainerContentsDocumentsRuntime } from "../../workflows/container-contents/runtime";
import { openDocumentStore, requestDomainDocumentSync } from "../documents";
import { relinkDocumentStoreWithCommitSideEffect } from "../documents/documentStore/internalRelink";
import { primeStoreDocuments, recoverStoreStaleRoot } from "./documentRecovery";
import { runContainerDocumentWork } from "./documentWork";
import {
  bumpMetadataSyncSeq,
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
type SyncContainerMetadata = typeof syncContainerMetadataState;

function requestContainerContentsStoreSync(
  state: ContainerContentsStoreSyncState,
) {
  state.syncLane?.requestSync();
}

function createRemoteSyncBlocker(runtime: ContainerContentsStoreRuntime) {
  return (organizationId: string) =>
    runtime.util.isRemoteSyncBlocked?.(organizationId) ?? false;
}

function captureStructuralSyncGeneration(
  state: ContainerContentsStoreSyncState,
  runtime: ContainerContentsStoreRuntime,
) {
  const activeContainerId = runtime.state.containerId;
  const activeOrganizationId = runtime.auth.organizationId;
  const lifecycleGeneration = state.lifecycleGeneration;
  const structuralGeneration = state.structuralGeneration;
  const domainScope = runtime.state.domainScope;
  const execSql = runtime.infra.execSql;
  const resolveProjectionUserKey = state.resolveProjectionUserKey;
  const syncLane = state.syncLane;
  return () =>
    state.lifecycleGeneration === lifecycleGeneration &&
    state.structuralGeneration === structuralGeneration &&
    state.runtime.auth.organizationId === activeOrganizationId &&
    state.runtime.state.containerId === activeContainerId &&
    state.runtime.state.domainScope === domainScope &&
    state.runtime.infra.execSql === execSql &&
    state.resolveProjectionUserKey === resolveProjectionUserKey &&
    state.syncLane === syncLane &&
    !syncLane?.isDisposed?.();
}

function createContainerContentsStoreDocumentMoveHost(
  state: ContainerContentsStoreSyncState,
): DocumentMoveIntentSyncHost<ContainerContentsStorePrimeDocumentRuntime> {
  const runtime = state.runtime;
  const domainScope = runtime.state.domainScope;
  return {
    documentWorkflowRuntime: (containerId) =>
      createContainerContentsDocumentsRuntime(runtime, containerId),
    openDocumentStore: ({ containerId, documentId, localId }) => {
      const store = openDocumentStore(
        domainScope,
        localId,
        createContainerContentsDocumentsRuntime(runtime, containerId),
        documentId,
      );
      return {
        assertCanRotateContentKey: () => store.assertCanRotateContentKey(),
        ensureInitialized: () => store.ensureInitialized(),
        relink: ({ commitSideEffect, ...input }) =>
          commitSideEffect
            ? relinkDocumentStoreWithCommitSideEffect(
                store,
                input,
                commitSideEffect,
              )
            : store.relink(input),
        requestSync: () => store.requestSync(),
        updateRuntime: (nextRuntime) => store.updateRuntime(nextRuntime),
      };
    },
  };
}

function syncPendingStoreDocumentMoves(input: {
  isCurrent: () => boolean;
  isRemoteSyncBlocked: (organizationId: string) => boolean;
  state: ContainerContentsStoreSyncState;
}) {
  return syncPendingDocumentMoveIntents({
    host: createContainerContentsStoreDocumentMoveHost(input.state),
    isCurrent: input.isCurrent,
    isRemoteSyncBlocked: input.isRemoteSyncBlocked,
    state: input.state,
  });
}

async function syncSingleContainerMetadata(input: {
  host: RemoteContainerHydrationHost;
  isCurrent: () => boolean;
  state: ContainerContentsStoreSyncState;
  containerState: ContainerState;
  encapsulationKeyPair: NonNullable<
    ContainerContentsStoreRuntime["crypto"]["encapsulationKeyPair"]
  >;
  syncContainerMetadata?: SyncContainerMetadata | undefined;
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
  const synced = await (
    input.syncContainerMetadata ?? syncContainerMetadataState
  )({
    forceReadSync:
      typeof metadataDocumentId === "string" &&
      state.metadataDocumentIdsNeedingSync.has(metadataDocumentId),
    locallyAcceptedUpdateIds: state.locallyAcceptedMetadataUpdateIds,
    isCurrent,
    metadataState: containerState,
    onDurableStateNeedsReload: () => {
      const currentDocumentId = state.containersById.get(
        containerState.container.id,
      )?.record.documentId;
      if (typeof currentDocumentId === "string") {
        state.metadataDocumentIdsNeedingSync.add(currentDocumentId);
        bumpMetadataSyncSeq(state.metadataSyncSignalSeqById, currentDocumentId);
      }
      requestContainerContentsStoreSync(state);
    },
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
  // syncContainerMetadataState settles its detached candidate into this live
  // object while preserving any metadata edit that completed or queued during
  // the remote pass. Do not install its returned detached record again here:
  // doing so would overwrite that preserved live edit.
  host.updateSnapshot();

  if (synced.shouldRequestFollowupSync) {
    requestContainerContentsStoreSync(state);
  }
}

interface ContainerContentsStoreSyncIterationInput {
  host: RemoteContainerHydrationHost;
  reconcileRestoredAccess: (isCurrent: () => boolean) => Promise<void>;
  requestRemoteReconciliation: (parentContainerId: string | null) => void;
  state: ContainerContentsStoreSyncState;
  syncContainerMetadata?: SyncContainerMetadata | undefined;
}

export async function runContainerContentsStoreSyncIteration(
  input: ContainerContentsStoreSyncIterationInput,
) {
  const { host, reconcileRestoredAccess, requestRemoteReconciliation, state } =
    input;
  const runtime = state.runtime;
  const encapsulationKeyPair = runtime.crypto.encapsulationKeyPair;
  if (
    runtime.infra.dbStatus !== "ready" ||
    !state.snapshot.ready ||
    !runtime.state.online ||
    !runtime.auth.isAuthenticated ||
    !encapsulationKeyPair
  ) {
    return;
  }
  const domainScope = runtime.state.domainScope;
  const isCurrent = captureStructuralSyncGeneration(state, runtime);

  await reconcileRestoredAccess(isCurrent);
  if (!isCurrent()) {
    return;
  }
  const isOrganizationBlocked = createRemoteSyncBlocker(runtime);

  const createdContainerCount = await syncPendingContainerCreateIntents({
    host,
    isCurrent,
    isRemoteSyncBlocked: isOrganizationBlocked,
    requestRemoteReconciliation,
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
    isCurrent,
    isRemoteSyncBlocked: isOrganizationBlocked,
    requestRemoteReconciliation,
    state,
  });
  if (!isCurrent()) {
    return;
  }
  if (movedContainerCount > 0) {
    state.documentStoresNeedPriming = true;
    host.updateSnapshot();
    requestDomainDocumentSync(domainScope);
    requestContainerContentsStoreSync(state);
  }

  for (const containerState of Array.from(state.containersById.values())) {
    await syncSingleContainerMetadata({
      containerState,
      encapsulationKeyPair,
      host,
      isCurrent,
      state,
      syncContainerMetadata: input.syncContainerMetadata,
    });
    if (!isCurrent()) {
      return;
    }
  }

  // Root adoption notifies session consumers synchronously. Let container
  // metadata converge first so a recovered system container is never exposed
  // under its placeholder name when the active root changes.
  await runContainerDocumentWork({
    isCurrent,
    onContextChanged: () => {
      if (isCurrent()) {
        requestContainerContentsStoreSync(state);
      }
    },
    onDocumentsMoved: () => {
      if (isCurrent()) {
        requestDomainDocumentSync(domainScope);
        requestContainerContentsStoreSync(state);
      }
    },
    primeDocuments: () => primeStoreDocuments(state, isCurrent),
    recoverStaleRoot: () => recoverStoreStaleRoot(state, isCurrent),
    shouldPrimeDocuments: () => state.documentStoresNeedPriming,
    // Document move intents live in the structural phase because they may
    // target containers created locally in the same session, such as Trash.
    // Root recovery rewrites stale endpoints and returns their intents to
    // pending, so replay follows recovery in this same pass.
    syncPendingDocumentMoves: () =>
      syncPendingStoreDocumentMoves({
        isCurrent,
        isRemoteSyncBlocked: isOrganizationBlocked,
        state,
      }),
  });
}

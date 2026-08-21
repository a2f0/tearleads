import { syncPendingContainerCreateIntents } from "../../workflows/container-contents/container-state/createIntentSync";
import { syncPendingContainerMoveIntents } from "../../workflows/container-contents/container-state/moveIntentSync";
import {
  type DocumentMoveIntentSyncHost,
  syncPendingDocumentMoveIntents,
} from "../../workflows/container-contents/documentMoveIntentSync";
import { loadLocalContainerStates } from "../../workflows/container-contents/localState";
import { syncContainerMetadataState } from "../../workflows/container-contents/metadata";
import {
  type ContainerState,
  createRemoteContainerIngestor,
  type RemoteContainer,
  type RemoteContainerHydrationHost,
} from "../../workflows/container-contents/remoteHydration";
import { createContainerContentsDocumentsRuntime } from "../../workflows/container-contents/runtime";
import {
  isDatabaseUnavailableError,
  registerContainerContentsSyncLane,
} from "../../workflows/container-contents/syncLane";
import { openDocumentStore, requestDomainDocumentSync } from "../documents";
import { createRestoredAccessReconciler } from "./accessRestorationSweep";
import {
  primeStoreDocumentSubtree,
  primeStoreDocuments,
  recoverStoreStaleRoot,
} from "./documentRecovery";
import { runContainerDocumentWork } from "./documentWork";
import { refreshLocalContainerStates } from "./localRefresh";
import { getContainerContentsStoreLogLabel } from "./logLabel";
import {
  clearMetadataSyncQueueIfUnchanged,
  readMetadataSyncSeq,
} from "./metadataSyncSignal";
import { handleContainerContentsRemoteEvents } from "./remoteEventSync";
import {
  type RemoteHydrationRefreshOptions,
  refreshAllRemoteHydration,
  refreshRootRemoteHydration,
} from "./remoteHydrationRefresh";
import { requestContainerContentsRemoteHydration } from "./remoteHydrationRequest";
import {
  hasStartupContainerSyncWork,
  scheduleStaleStartupRemoteHydration,
} from "./startupHydration";
import type {
  ContainerContentsStoreRuntime,
  ContainerContentsStoreSyncState,
} from "./syncAgentTypes";

export type {
  ContainerContentsStoreRuntime,
  ContainerContentsStoreSyncState,
} from "./syncAgentTypes";
export type { ContainerState };

export interface ContainerContentsStoreSyncAgent {
  ensureInitialized: () => void;
  handleRemoteEvents: () => void;
  ingestRemoteContainer: (remoteContainer: RemoteContainer) => Promise<void>;
  primeDocumentsForSharedSubtree: (rootContainerId: string) => Promise<void>;
  refreshLocalContainers: () => Promise<void>;
  refresh: () => Promise<boolean>;
  refreshRootLane: (options?: RefreshRootLaneOptions) => Promise<boolean>;
  requestRemoteHydration: (options?: {
    followDiscoveredParentLanes?: boolean | undefined;
    parentIds?: ReadonlyArray<string | null> | undefined;
  }) => Promise<void>;
  scheduleRemoteHydration: () => void;
  scheduleSync: () => void;
}

export interface RefreshRootLaneOptions {
  readonly includeActiveRootChildLane?: boolean | undefined;
  // Extra parent lanes to re-list alongside the root lane. Used by the
  // resync_required handler to re-list a flagged container's parent lane so a
  // tombstone only visible there (a deleted nested container reached via its
  // parent, rootDiscoveryVisible=false) is still applied without the full crawl.
  readonly parentIds?: ReadonlyArray<string | null> | undefined;
}

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

function createSchedulingRemoteContainerIngestor(input: {
  host: RemoteContainerHydrationHost;
  scheduleSync: () => void;
  state: ContainerContentsStoreSyncState;
}): ContainerContentsStoreSyncAgent["ingestRemoteContainer"] {
  const { host, scheduleSync, state } = input;
  const ingestRemoteContainer = createRemoteContainerIngestor({ host, state });
  return async (remoteContainer) => {
    await ingestRemoteContainer(remoteContainer);
    if (state.documentStoresNeedPriming) {
      scheduleSync();
    }
  };
}

async function initializeContainerContentsStore(input: {
  host: RemoteContainerHydrationHost;
  isCurrent: () => boolean;
  scheduleSync: () => void;
  state: ContainerContentsStoreSyncState;
}) {
  const { host, isCurrent, scheduleSync, state } = input;
  const persistence = state.persistence;
  const runtime = state.runtime;
  if (runtime.infra.dbStatus !== "ready") {
    return;
  }

  const localContainerStates = await loadLocalContainerStates({
    persistence,
    runtime,
  });
  if (!isCurrent()) {
    return;
  }

  for (const containerState of localContainerStates) {
    state.containersById.set(containerState.container.id, containerState);
  }

  state.initialized = true;

  const shouldScheduleStaleRootRecovery =
    await scheduleStaleStartupRemoteHydration({
      isCurrent,
      requestHydration: () =>
        requestContainerContentsRemoteHydration({
          host,
          scheduleSync,
          state,
        }),
      state,
    });
  if (!isCurrent()) {
    return;
  }
  const hasPendingRestorationSweep =
    typeof runtime.auth.userId === "string" &&
    (
      await persistence.listDormantMetadataSweepRequests(
        runtime.infra.execSql,
        runtime.auth.userId,
      )
    ).length > 0;
  if (!isCurrent()) {
    return;
  }

  host.updateSnapshot();

  runtime.util.log(
    `${getContainerContentsStoreLogLabel(state)}: loaded ${state.containersById.size} container(s)`,
  );

  if (runtime.auth.isAuthenticated && runtime.state.online) {
    const hasStartupWork =
      shouldScheduleStaleRootRecovery ||
      hasPendingRestorationSweep ||
      (await hasStartupContainerSyncWork(state));
    if (!isCurrent() || !hasStartupWork) {
      return;
    }
    runtime.util.log(
      shouldScheduleStaleRootRecovery
        ? `${getContainerContentsStoreLogLabel(state)}: startup detected stale root recovery; scheduling lane pass`
        : `${getContainerContentsStoreLogLabel(state)}: startup detected durable sync work; scheduling lane pass`,
    );
    scheduleSync();
  }
}

function ensureContainerContentsStoreInitialized(input: {
  host: RemoteContainerHydrationHost;
  scheduleSync: () => void;
  state: ContainerContentsStoreSyncState;
}) {
  const { host, scheduleSync, state } = input;
  if (state.initialized || state.runtime.infra.dbStatus !== "ready") {
    return;
  }
  if (state.initializePromise) {
    return;
  }

  const lifecycleGeneration = state.lifecycleGeneration;
  const isCurrent = () => state.lifecycleGeneration === lifecycleGeneration;
  state.initializeGeneration = lifecycleGeneration;
  const initializePromise = initializeContainerContentsStore({
    host,
    isCurrent,
    scheduleSync,
    state,
  })
    .catch((error: unknown) => {
      if (!isCurrent() || isDatabaseUnavailableError(error)) {
        return;
      }

      throw error;
    })
    .finally(() => {
      if (state.initializePromise !== initializePromise) {
        return;
      }
      state.initializePromise = null;
      state.initializeGeneration = null;
      if (!isCurrent() && state.runtime.infra.dbStatus === "ready") {
        ensureContainerContentsStoreInitialized(input);
      }
    });
  state.initializePromise = initializePromise;
}

async function syncSingleContainerMetadata(input: {
  host: RemoteContainerHydrationHost;
  state: ContainerContentsStoreSyncState;
  containerState: ContainerState;
  encapsulationKeyPair: NonNullable<
    ContainerContentsStoreRuntime["crypto"]["encapsulationKeyPair"]
  >;
}) {
  const { containerState, encapsulationKeyPair, host, state } = input;
  const metadataDocumentId = containerState.record.documentId;
  // Snapshot THIS metadata document's enqueue sequence before the network GET
  // so the post-await clear can tell whether a remote event re-queued this
  // specific id mid-pass (see metadataSyncSignal.ts). Per id, not a global
  // counter, so an unrelated container's event does not force a re-sync here.
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
  if (!synced) {
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
  containerState.record = synced.record;
  host.updateSnapshot();

  if (synced.shouldRequestFollowupSync) {
    requestContainerContentsStoreSync(state);
  }
}

async function runContainerContentsStoreSyncIteration(input: {
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
  await reconcileRestoredAccess();
  const isOrganizationBlocked = (organizationId: string) =>
    isRemoteSyncBlocked(state, organizationId);

  const createdContainerCount = await syncPendingContainerCreateIntents({
    host,
    isRemoteSyncBlocked: isOrganizationBlocked,
    state,
  });
  if (createdContainerCount > 0) {
    state.documentStoresNeedPriming = true;
    host.updateSnapshot();
  }

  const movedContainerCount = await syncPendingContainerMoveIntents({
    host,
    isRemoteSyncBlocked: isOrganizationBlocked,
    state,
  });
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
      state,
    });
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

export function createContainerContentsStoreSyncAgent(input: {
  host: RemoteContainerHydrationHost;
  state: ContainerContentsStoreSyncState;
}): ContainerContentsStoreSyncAgent {
  const { host, state } = input;
  const scheduleSync = () => requestContainerContentsStoreSync(state);
  const ingestRemoteContainer = createSchedulingRemoteContainerIngestor({
    host,
    scheduleSync,
    state,
  });

  const requestHydration: ContainerContentsStoreSyncAgent["requestRemoteHydration"] =
    (options = {}) =>
      requestContainerContentsRemoteHydration({
        followDiscoveredParentLanes: options.followDiscoveredParentLanes,
        host,
        parentIds: options.parentIds,
        scheduleSync,
        state,
      });
  const requestRefreshHydration = (options: RemoteHydrationRefreshOptions) =>
    requestContainerContentsRemoteHydration({
      ...options,
      host,
      scheduleSync,
      state,
    });
  const reconcileRestoredAccess = createRestoredAccessReconciler({
    requestHydration: requestRefreshHydration,
    state,
  });

  state.syncLane = registerContainerContentsSyncLane({
    domainScope: state.runtime.state.domainScope,
    run: () =>
      runContainerContentsStoreSyncIteration({
        host,
        reconcileRestoredAccess,
        state,
      }),
  });

  return {
    ensureInitialized: () =>
      ensureContainerContentsStoreInitialized({ host, scheduleSync, state }),
    handleRemoteEvents: () =>
      handleContainerContentsRemoteEvents({
        requestHydration,
        scheduleSync,
        state,
      }),
    ingestRemoteContainer,
    primeDocumentsForSharedSubtree: (rootContainerId: string) =>
      primeStoreDocumentSubtree(state, rootContainerId),
    refreshLocalContainers: () => refreshLocalContainerStates({ host, state }),
    refresh: () =>
      refreshAllRemoteHydration({
        requestHydration: requestRefreshHydration,
        state,
      }),
    refreshRootLane: (options) =>
      refreshRootRemoteHydration({
        includeActiveRootChildLane: options?.includeActiveRootChildLane,
        parentIds: options?.parentIds,
        requestHydration: requestRefreshHydration,
        state,
      }),
    requestRemoteHydration: requestHydration,
    scheduleRemoteHydration: () => {
      void requestHydration();
    },
    scheduleSync,
  };
}

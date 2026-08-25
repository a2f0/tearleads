import { syncPendingContainerCreateIntents } from "../../workflows/container-contents/container-state/createIntentSync";
import { syncPendingContainerMoveIntents } from "../../workflows/container-contents/container-state/moveIntentSync";
import {
  type DocumentMoveIntentSyncHost,
  syncPendingDocumentMoveIntents,
} from "../../workflows/container-contents/documentMoveIntentSync";
import { loadLocalContainerStates } from "../../workflows/container-contents/localState";
import {
  installContainerMetadataRecord,
  syncContainerMetadataState,
} from "../../workflows/container-contents/metadata";
import type {
  ContainerState,
  RemoteContainer,
  RemoteContainerHydrationHost,
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
import { removeMissingSyncedContainerState } from "./missingSyncedContainerState";
import { createRemoteContainerIngestionController } from "./remoteContainerIngestion";
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

async function initializeContainerContentsStore(input: {
  host: RemoteContainerHydrationHost;
  isCurrent: () => boolean;
  resumeRecoveryWork: () => Promise<void>;
  scheduleSync: () => void;
  state: ContainerContentsStoreSyncState;
}) {
  const { host, isCurrent, resumeRecoveryWork, scheduleSync, state } = input;
  const persistence = state.persistence;
  const loadRuntime = state.runtime;
  if (loadRuntime.infra.dbStatus !== "ready") {
    return;
  }

  const localContainerStates = await loadLocalContainerStates({
    persistence,
    runtime: loadRuntime,
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
          resumeRecoveryWork,
          scheduleSync,
          state,
        }),
      state,
    });
  if (!isCurrent()) {
    return;
  }
  const runtime = state.runtime;
  const hasPendingRestorationSweep =
    typeof runtime.auth.userId === "string" &&
    (
      await persistence.listDormantMetadataSweepRequests(
        loadRuntime.infra.execSql,
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

  const currentRuntime = state.runtime;
  if (currentRuntime.auth.isAuthenticated && currentRuntime.state.online) {
    const hasStartupWork =
      shouldScheduleStaleRootRecovery ||
      hasPendingRestorationSweep ||
      (await hasStartupContainerSyncWork(state));
    if (!isCurrent() || !hasStartupWork) {
      return;
    }
    currentRuntime.util.log(
      shouldScheduleStaleRootRecovery
        ? `${getContainerContentsStoreLogLabel(state)}: startup detected stale root recovery; scheduling lane pass`
        : `${getContainerContentsStoreLogLabel(state)}: startup detected durable sync work; scheduling lane pass`,
    );
    scheduleSync();
  }
}

function waitForStaleLocalRefreshBeforeInitialization(input: {
  host: RemoteContainerHydrationHost;
  resumeRecoveryWork: () => Promise<void>;
  scheduleSync: () => void;
  state: ContainerContentsStoreSyncState;
}): boolean {
  const { state } = input;
  const activeRefresh = state.localContainerRefreshPromise;
  if (
    !activeRefresh ||
    state.localContainerRefreshGeneration === state.lifecycleGeneration
  ) {
    return false;
  }

  const lifecycleGeneration = state.lifecycleGeneration;
  state.initializeGeneration = lifecycleGeneration;
  const releaseInitializationBarrier = () => {
    if (state.initializePromise !== initializationBarrier) {
      return;
    }
    state.initializePromise = null;
    state.initializeGeneration = null;
    if (state.runtime.infra.dbStatus === "ready") {
      ensureContainerContentsStoreInitialized(input);
    }
  };
  const initializationBarrier = activeRefresh.then(
    releaseInitializationBarrier,
    releaseInitializationBarrier,
  );
  state.initializePromise = initializationBarrier;
  return true;
}

function ensureContainerContentsStoreInitialized(input: {
  host: RemoteContainerHydrationHost;
  resumeRecoveryWork: () => Promise<void>;
  scheduleSync: () => void;
  state: ContainerContentsStoreSyncState;
}) {
  const { host, resumeRecoveryWork, scheduleSync, state } = input;
  if (state.initialized || state.runtime.infra.dbStatus !== "ready") {
    return;
  }
  if (state.initializePromise) {
    return;
  }
  if (waitForStaleLocalRefreshBeforeInitialization(input)) {
    return;
  }

  const lifecycleGeneration = state.lifecycleGeneration;
  const isCurrent = () => state.lifecycleGeneration === lifecycleGeneration;
  state.initializeGeneration = lifecycleGeneration;
  const initializePromise = initializeContainerContentsStore({
    host,
    isCurrent,
    resumeRecoveryWork,
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
  if (!synced) {
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
  const remoteContainerIngestion = createRemoteContainerIngestionController({
    host,
    scheduleSync,
    state,
  });
  const resumeRecoveryWork = remoteContainerIngestion.resumeInterruptedWork;

  const requestHydration: ContainerContentsStoreSyncAgent["requestRemoteHydration"] =
    (options = {}) =>
      requestContainerContentsRemoteHydration({
        followDiscoveredParentLanes: options.followDiscoveredParentLanes,
        host,
        parentIds: options.parentIds,
        resumeRecoveryWork,
        scheduleSync,
        state,
      });
  const requestRefreshHydration = (options: RemoteHydrationRefreshOptions) =>
    requestContainerContentsRemoteHydration({
      ...options,
      host,
      resumeRecoveryWork,
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
    ensureInitialized: () => {
      ensureContainerContentsStoreInitialized({
        host,
        resumeRecoveryWork,
        scheduleSync,
        state,
      });
      void resumeRecoveryWork();
    },
    handleRemoteEvents: () =>
      handleContainerContentsRemoteEvents({
        requestHydration,
        scheduleSync,
        state,
      }),
    ingestRemoteContainer: remoteContainerIngestion.ingest,
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

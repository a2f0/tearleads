import { loadLocalContainerStates } from "../../workflows/container-contents/localState";
import type {
  ContainerState,
  RemoteContainer,
  RemoteContainerHydrationHost,
} from "../../workflows/container-contents/remoteHydration";
import {
  isDatabaseUnavailableError,
  registerContainerContentsSyncLane,
} from "../../workflows/container-contents/syncLane";
import { createRestoredAccessReconciler } from "./accessRestorationSweep";
import { primeStoreDocumentSubtree } from "./documentRecovery";
import { refreshLocalContainerStates } from "./localRefresh";
import { getContainerContentsStoreLogLabel } from "./logLabel";
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
import { consumePendingContainerContentsReconnectRefresh } from "./state";
import type { ContainerContentsStoreSyncState } from "./syncAgentTypes";
import { runContainerContentsStoreSyncIteration } from "./syncLaneIteration";

export type {
  ContainerContentsStoreRuntime,
  ContainerContentsStoreSyncState,
} from "./syncAgentTypes";
export type { ContainerState };

export interface ContainerContentsStoreSyncAgent {
  ensureInitialized: () => void;
  handleRemoteEvents: () => void;
  ingestRemoteContainer: (remoteContainer: RemoteContainer) => Promise<void>;
  primeDocumentsForSharedSubtree: (
    rootContainerId: string,
    isCurrent?: (() => boolean) | undefined,
  ) => Promise<void>;
  refreshLocalContainers: () => Promise<void>;
  refresh: () => Promise<boolean>;
  refreshRootLane: (options?: RefreshRootLaneOptions) => Promise<boolean>;
  requestRemoteHydration: (options?: {
    followDiscoveredParentLanes?: boolean | undefined;
    parentIds?: ReadonlyArray<string | null> | undefined;
    resetAllLaneWatermarks?: boolean | undefined;
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

function requestContainerContentsStoreSync(
  state: ContainerContentsStoreSyncState,
) {
  state.syncLane?.requestSync();
}

async function initializeContainerContentsStore(input: {
  handleRemoteEvents: () => void;
  host: RemoteContainerHydrationHost;
  isCurrent: () => boolean;
  resumeRecoveryWork: () => Promise<void>;
  scheduleSync: () => void;
  state: ContainerContentsStoreSyncState;
}) {
  const {
    handleRemoteEvents,
    host,
    isCurrent,
    resumeRecoveryWork,
    scheduleSync,
    state,
  } = input;
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
  handleRemoteEvents();

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
  handleRemoteEvents: () => void;
  host: RemoteContainerHydrationHost;
  refreshAfterReconnect: () => Promise<boolean>;
  resumeRecoveryWork: () => Promise<void>;
  scheduleSync: () => void;
  state: ContainerContentsStoreSyncState;
}): boolean {
  const { state } = input;
  const activeRefresh = state.localContainerRefreshPromise;
  if (
    !activeRefresh ||
    (state.localContainerRefreshGeneration === state.lifecycleGeneration &&
      state.localContainerRefreshStructuralGeneration ===
        state.structuralGeneration)
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
  handleRemoteEvents: () => void;
  host: RemoteContainerHydrationHost;
  refreshAfterReconnect: () => Promise<boolean>;
  resumeRecoveryWork: () => Promise<void>;
  scheduleSync: () => void;
  state: ContainerContentsStoreSyncState;
}) {
  const { handleRemoteEvents, host, resumeRecoveryWork, scheduleSync, state } =
    input;
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
  const persistence = state.persistence;
  const execSql = state.runtime.infra.execSql;
  const isCurrent = () =>
    state.lifecycleGeneration === lifecycleGeneration &&
    state.persistence === persistence &&
    state.runtime.infra.execSql === execSql;
  state.initializeGeneration = lifecycleGeneration;
  const initializePromise = initializeContainerContentsStore({
    handleRemoteEvents,
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
      if (isCurrent()) {
        consumePendingContainerContentsReconnectRefresh(
          state,
          input.refreshAfterReconnect,
        );
      } else if (state.runtime.infra.dbStatus === "ready") {
        ensureContainerContentsStoreInitialized(input);
      }
    });
  state.initializePromise = initializePromise;
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
        resetAllLaneWatermarks: options.resetAllLaneWatermarks,
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
  const refresh = () =>
    refreshAllRemoteHydration({
      requestHydration: requestRefreshHydration,
      state,
    });
  const handleRemoteEvents = () =>
    handleContainerContentsRemoteEvents({
      requestHydration,
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
        requestRemoteReconciliation: (parentContainerId) => {
          void requestHydration({
            followDiscoveredParentLanes: false,
            parentIds: [parentContainerId],
          });
        },
        state,
      }),
  });

  return {
    ensureInitialized: () => {
      ensureContainerContentsStoreInitialized({
        handleRemoteEvents,
        host,
        refreshAfterReconnect: refresh,
        resumeRecoveryWork,
        scheduleSync,
        state,
      });
      void resumeRecoveryWork();
    },
    handleRemoteEvents,
    ingestRemoteContainer: remoteContainerIngestion.ingest,
    primeDocumentsForSharedSubtree: (rootContainerId, isCurrent) =>
      primeStoreDocumentSubtree(state, rootContainerId, isCurrent),
    refreshLocalContainers: () => refreshLocalContainerStates({ host, state }),
    refresh,
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

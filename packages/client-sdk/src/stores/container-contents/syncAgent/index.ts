import { loadLocalContainerStates } from "../../../workflows/container-contents/localState";
import type {
  ContainerState,
  RemoteContainerHydrationHost,
} from "../../../workflows/container-contents/remoteHydration";
import {
  isDatabaseUnavailableError,
  registerContainerContentsSyncLane,
} from "../../../workflows/container-contents/syncLane";
import { loadOrganizationSyncPausesBeforeSync } from "../../../workflows/sync/coordination";
import { createRestoredAccessReconciler } from "../accessRestorationSweep";
import { ownsContainerStore } from "../containerState/storeScope";
import { primeStoreDocumentSubtree } from "../documentWork/documentRecovery";
import { observeContainerBackgroundHydration } from "../hydration/backgroundHydration";
import {
  type RemoteHydrationRefreshOptions,
  refreshAllRemoteHydration,
  refreshRootRemoteHydration,
} from "../hydration/remoteHydrationRefresh";
import { requestContainerContentsRemoteHydration } from "../hydration/remoteHydrationRequest";
import {
  hasStartupContainerSyncWork,
  inspectStartupHydration,
} from "../hydration/startupHydration";
import { refreshLocalContainerStates } from "../localRefresh";
import { getContainerContentsStoreLogLabel } from "../logLabel";
import { createRemoteContainerIngestionController } from "../remoteEvents/remoteContainerIngestion";
import { handleContainerContentsRemoteEvents } from "../remoteEvents/remoteEventSync";
import {
  consumePendingContainerContentsReconnectRefresh,
  retireContainerStore,
} from "../state";
import type {
  ContainerContentsStoreSyncAgent,
  ContainerContentsStoreSyncState,
} from "./syncAgentTypes";
import { runContainerContentsStoreSyncIteration } from "./syncLaneIteration";

export type { ContainerState } from "../../../workflows/container-contents/remoteHydration";
export type {
  ContainerContentsStoreRuntime,
  ContainerContentsStoreSyncAgent,
  ContainerContentsStoreSyncState,
  RefreshRootLaneOptions,
} from "./syncAgentTypes";

function requestContainerContentsStoreSync(
  state: ContainerContentsStoreSyncState,
) {
  state.syncLane?.requestSync();
}

function publishInitialContainers(
  state: ContainerContentsStoreSyncState,
  startup: {
    containersById: ReadonlyMap<string, ContainerState>;
    rootLaneHydrated: boolean;
    containerParentIdsNeedingHydration: ReadonlySet<string | null>;
  },
): boolean {
  for (const [id, row] of startup.containersById) {
    state.containersById.set(id, row);
  }
  state.initialized = true;
  state.rootLaneHydrated = startup.rootLaneHydrated;
  for (const id of startup.containerParentIdsNeedingHydration) {
    state.containerParentIdsNeedingHydration.add(id);
  }
  return startup.containerParentIdsNeedingHydration.size > 0;
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

  await loadOrganizationSyncPausesBeforeSync({
    domainScope: loadRuntime.state.domainScope,
    execSql: loadRuntime.infra.execSql,
    log: loadRuntime.util.log,
  });
  const localContainerStates = await loadLocalContainerStates({
    isCurrent,
    persistence,
    runtime: loadRuntime,
  });
  if (!isCurrent()) {
    return;
  }

  // Keep the local tree and marker reads private until this initialization
  // can publish them together. Another organization can take over between reads.
  const startup = {
    runtime: state.runtime,
    containersById: new Map(
      localContainerStates.map((row) => [row.container.id, row]),
    ),
    containerParentIdsNeedingHydration: new Set<string | null>(),
    rootLaneHydrated: state.rootLaneHydrated,
  };
  const shouldScheduleStaleRootRecovery = await inspectStartupHydration({
    isCurrent,
    state: startup,
  });
  if (!isCurrent()) return;
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

  if (publishInitialContainers(state, startup)) {
    observeContainerBackgroundHydration(
      state,
      requestContainerContentsRemoteHydration({
        host,
        resumeRecoveryWork,
        scheduleSync,
        state,
      }),
    );
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
  refreshAfterReconnect: ContainerContentsStoreSyncAgent["refresh"];
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
  refreshAfterReconnect: ContainerContentsStoreSyncAgent["refresh"];
  resumeRecoveryWork: () => Promise<void>;
  scheduleSync: () => void;
  state: ContainerContentsStoreSyncState;
}) {
  const { handleRemoteEvents, host, resumeRecoveryWork, scheduleSync, state } =
    input;
  if (state.initialized || state.runtime.infra.dbStatus !== "ready") {
    return;
  }
  if (!ownsContainerStore(state) || state.initializePromise) {
    return;
  }
  if (waitForStaleLocalRefreshBeforeInitialization(input)) {
    return;
  }

  const lifecycleGeneration = state.lifecycleGeneration;
  // A first login adopts device-local rows on this executor. A later owner must reload them.
  const startedAnonymous = !state.runtime.auth.isAuthenticated;
  const writeGeneration = state.writeGeneration;
  const persistence = state.persistence;
  const execSql = state.runtime.infra.execSql;
  const isCurrent = () =>
    ownsContainerStore(state) &&
    (state.writeGeneration === writeGeneration ||
      (startedAnonymous &&
        state.runtime.auth.isAuthenticated &&
        state.writeGeneration === writeGeneration + 1)) &&
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
        if (!state.snapshot.ready) state.initialized = false;
        ensureContainerContentsStoreInitialized(input);
      }
    });
  state.initializePromise = initializePromise;
}

// Read the runtime lazily: updateRuntime replaces state.runtime, so a
// reference captured at lane registration would report into a dead identity's
// host. Returns the host's result: both callbacks are declared `=> void` but
// may be async, and the lane reporter only catches a rejection it is handed.
function logSyncLaneFailure(
  state: ContainerContentsStoreSyncState,
  message: string,
  error: unknown,
): unknown {
  const { log, logError } = state.runtime.util;
  return logError ? logError(message, error) : log(message);
}

function createHydrationRequester(input: {
  host: RemoteContainerHydrationHost;
  resumeRecoveryWork: () => Promise<void>;
  scheduleSync: () => void;
  state: ContainerContentsStoreSyncState;
}): ContainerContentsStoreSyncAgent["requestRemoteHydration"] {
  return (options = {}) =>
    requestContainerContentsRemoteHydration({
      ...input,
      followDiscoveredParentLanes: options.followDiscoveredParentLanes,
      parentIds: options.parentIds,
      resetAllLaneWatermarks: options.resetAllLaneWatermarks,
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

  const requestHydration = createHydrationRequester({
    host,
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
  const scheduleHydration = (
    options?: Parameters<typeof requestHydration>[0],
  ) => observeContainerBackgroundHydration(state, requestHydration(options));
  const refresh: ContainerContentsStoreSyncAgent["refresh"] = (options) =>
    refreshAllRemoteHydration({
      // Explicit user refresh must rediscover children hidden by unsigned hints.
      resetAllLaneWatermarks: options?.resetAllLaneWatermarks,
      reconnect: options?.reconnect,
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
    onDispose: () => retireContainerStore(state),
    domainScope: state.runtime.state.domainScope,
    logError: (message, error) => logSyncLaneFailure(state, message, error),
    run: (policyOperation) =>
      runContainerContentsStoreSyncIteration({
        host,
        policyOperation,
        reconcileRestoredAccess,
        requestRemoteReconciliation: (parentContainerId) => {
          scheduleHydration({
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
    scheduleRemoteHydration: scheduleHydration,
    scheduleSync,
  };
}

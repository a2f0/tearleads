import {
  type ContainerContentsPersistence,
  type ContainerContentsProjectionUserKeyResolver,
  type ContainerContentsSyncLane,
  type ContainerContentsWorkflowRuntime,
  type ContainerDocumentPrimeHost,
  type ContainerDocumentPrimeStore,
  type ContainerState,
  createRemoteContainerIngestor,
  hasContainerMetadataDocumentUpdateEvent,
  hydrateRemoteContainers,
  isDestroyedContainerContentsSyncRuntimeError,
  loadLocalContainerStates,
  primeDocumentsForContainerSubtree,
  type RemoteContainer,
  type RemoteContainerHydrationHost,
  registerContainerContentsSyncLane,
  syncContainerMetadataState,
  syncPendingContainerCreateIntents,
} from "../../workflows/container-contents";
import { primeDocumentStore } from "../documents";

export type { ContainerState };

export type ContainerContentsStoreRuntime = ContainerContentsWorkflowRuntime;

export interface ContainerContentsStoreSyncState {
  containersById: Map<string, ContainerState>;
  initializePromise: Promise<void> | null;
  initialized: boolean;
  lastEventCount: number;
  logLabel?: string | undefined;
  persistence: ContainerContentsPersistence;
  remoteHydrationPromise: Promise<void> | null;
  resolveProjectionUserKey: ContainerContentsProjectionUserKeyResolver;
  runtime: ContainerContentsStoreRuntime;
  snapshot: {
    ready: boolean;
  };
  syncLane: ContainerContentsSyncLane | null;
}

export interface ContainerContentsStoreSyncAgent {
  ensureInitialized: () => void;
  handleRemoteEvents: () => void;
  ingestRemoteContainer: (remoteContainer: RemoteContainer) => Promise<void>;
  primeDocumentsForSharedSubtree: (rootContainerId: string) => Promise<void>;
  refresh: () => Promise<boolean>;
  requestRemoteHydration: () => Promise<void>;
  scheduleRemoteHydration: () => void;
  scheduleSync: () => void;
}

type ContainerContentsStoreSyncHost = RemoteContainerHydrationHost;
type ContainerContentsStorePrimeDocumentRuntime = ReturnType<
  ContainerContentsStoreRuntime["createDocumentsRuntime"]
>;

function getContainerContentsStoreLogLabel(
  state: ContainerContentsStoreSyncState,
): string {
  return state.logLabel ?? "Container contents";
}

function requestContainerContentsStoreSync(
  state: ContainerContentsStoreSyncState,
) {
  state.syncLane?.requestSync();
}

function createContainerContentsStoreDocumentPrimeHost(
  state: ContainerContentsStoreSyncState,
): ContainerDocumentPrimeHost<ContainerContentsStorePrimeDocumentRuntime> {
  return {
    createDocumentRuntime: (containerId) =>
      state.runtime.createDocumentsRuntime(containerId),
    primeDocumentStore: ({
      documentId,
      localId,
      runtime,
    }): ContainerDocumentPrimeStore =>
      primeDocumentStore(
        state.runtime.domainScope,
        localId,
        runtime,
        documentId,
      ),
  };
}

async function primeDocumentsForSharedSubtree(
  state: ContainerContentsStoreSyncState,
  rootContainerId: string,
) {
  await primeDocumentsForContainerSubtree({
    containersById: state.containersById,
    host: createContainerContentsStoreDocumentPrimeHost(state),
    rootContainerId,
    runtime: state.runtime,
  });
}

function requestRemoteHydration(input: {
  host: ContainerContentsStoreSyncHost;
  scheduleSync: () => void;
  state: ContainerContentsStoreSyncState;
}): Promise<void> {
  const { host, scheduleSync, state } = input;
  if (state.remoteHydrationPromise) {
    return state.remoteHydrationPromise;
  }

  state.remoteHydrationPromise = hydrateRemoteContainers({
    host,
    state,
  })
    .catch((error: unknown) => {
      if (isDestroyedContainerContentsSyncRuntimeError(error)) {
        return;
      }

      throw error;
    })
    .finally(() => {
      state.remoteHydrationPromise = null;

      if (
        state.snapshot.ready &&
        state.runtime.isAuthenticated &&
        state.runtime.online
      ) {
        scheduleSync();
      }
    });

  return state.remoteHydrationPromise;
}

async function initializeContainerContentsStore(input: {
  host: ContainerContentsStoreSyncHost;
  scheduleSync: () => void;
  state: ContainerContentsStoreSyncState;
}) {
  const { host, scheduleSync, state } = input;
  if (state.runtime.dbStatus !== "ready") {
    return;
  }

  const localContainerStates = await loadLocalContainerStates({
    persistence: state.persistence,
    runtime: state.runtime,
  });

  for (const containerState of localContainerStates) {
    state.containersById.set(containerState.container.id, containerState);
  }

  state.initialized = true;
  state.initializePromise = null;
  host.updateSnapshot();

  state.runtime.log(
    `${getContainerContentsStoreLogLabel(state)}: loaded ${state.containersById.size} container(s)`,
  );

  if (state.runtime.isAuthenticated && state.runtime.online) {
    await hydrateRemoteContainers({ host, state });
  }

  if (
    state.containersById.size > 0 ||
    (state.runtime.isAuthenticated && state.runtime.online)
  ) {
    scheduleSync();
  }
}

function ensureContainerContentsStoreInitialized(input: {
  host: ContainerContentsStoreSyncHost;
  scheduleSync: () => void;
  state: ContainerContentsStoreSyncState;
}) {
  const { host, scheduleSync, state } = input;
  if (
    state.initialized ||
    state.initializePromise ||
    state.runtime.dbStatus !== "ready"
  ) {
    return;
  }

  state.initializePromise = initializeContainerContentsStore({
    host,
    scheduleSync,
    state,
  }).catch((error: unknown) => {
    state.initializePromise = null;

    if (isDestroyedContainerContentsSyncRuntimeError(error)) {
      return;
    }

    throw error;
  });
}

async function syncSingleContainerMetadata(input: {
  host: ContainerContentsStoreSyncHost;
  state: ContainerContentsStoreSyncState;
  containerState: ContainerState;
  encapsulationKeyPair: NonNullable<
    ContainerContentsStoreRuntime["encapsulationKeyPair"]
  >;
}) {
  const { containerState, encapsulationKeyPair, host, state } = input;
  const synced = await syncContainerMetadataState({
    metadataState: containerState,
    persistence: state.persistence,
    resolveProjectionUserKey: state.resolveProjectionUserKey,
    runtime: state.runtime,
    targetSecretKey: encapsulationKeyPair.secretKey,
  });
  if (!synced) {
    return;
  }

  containerState.container = synced.container;
  containerState.record = synced.record;
  host.updateSnapshot();

  if (synced.shouldRequestFollowupSync) {
    requestContainerContentsStoreSync(state);
  }
}

async function runContainerContentsStoreSyncIteration(input: {
  host: ContainerContentsStoreSyncHost;
  state: ContainerContentsStoreSyncState;
}) {
  const { host, state } = input;
  const encapsulationKeyPair = state.runtime.encapsulationKeyPair;
  if (
    state.runtime.dbStatus !== "ready" ||
    !state.snapshot.ready ||
    !state.runtime.online ||
    !state.runtime.isAuthenticated ||
    !encapsulationKeyPair
  ) {
    return;
  }

  const createdContainerCount = await syncPendingContainerCreateIntents({
    host,
    state,
  });
  if (createdContainerCount > 0) {
    host.updateSnapshot();
  }

  for (const containerState of Array.from(state.containersById.values())) {
    await syncSingleContainerMetadata({
      containerState,
      encapsulationKeyPair,
      host,
      state,
    });
  }
}

export function createContainerContentsStoreSyncAgent(input: {
  host: ContainerContentsStoreSyncHost;
  state: ContainerContentsStoreSyncState;
}): ContainerContentsStoreSyncAgent {
  const { host, state } = input;

  state.syncLane = registerContainerContentsSyncLane({
    domainScope: state.runtime.domainScope,
    run: () => runContainerContentsStoreSyncIteration({ host, state }),
  });
  const scheduleSync = () => requestContainerContentsStoreSync(state);
  const ingestRemoteContainer = createRemoteContainerIngestor({
    host,
    state,
  });

  const requestHydration = () =>
    requestRemoteHydration({ host, scheduleSync, state });

  return {
    ensureInitialized: () =>
      ensureContainerContentsStoreInitialized({ host, scheduleSync, state }),
    handleRemoteEvents: () => {
      const nextEvents = state.runtime.events.slice(state.lastEventCount);
      state.lastEventCount = state.runtime.events.length;

      if (
        hasContainerMetadataDocumentUpdateEvent(
          nextEvents,
          state.containersById.values(),
        )
      ) {
        scheduleSync();
      }
    },
    ingestRemoteContainer,
    primeDocumentsForSharedSubtree: (rootContainerId: string) =>
      primeDocumentsForSharedSubtree(state, rootContainerId),
    refresh: () => {
      if (
        state.runtime.dbStatus !== "ready" ||
        !state.initialized ||
        !state.runtime.isAuthenticated ||
        !state.runtime.online
      ) {
        return Promise.resolve(false);
      }

      return requestHydration().then(() => true);
    },
    requestRemoteHydration: requestHydration,
    scheduleRemoteHydration: () => {
      void requestHydration();
    },
    scheduleSync,
  };
}

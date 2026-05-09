import type { BlobStore } from "../../data/blobs";
import type { useAppData } from "../../providers/data/AppDataProvider";
import {
  createRemoteExplorerContainerIngestor,
  type ExplorerContainerState,
  type ExplorerDocumentPrimeHost,
  type ExplorerDocumentPrimeStore,
  type ExplorerPersistence,
  type ExplorerProjectionUserKeyResolver,
  type ExplorerRemoteContainer,
  type ExplorerRemoteContainerHydrationHost,
  type ExplorerSyncLane,
  enqueuePendingExplorerContainerUpdateFromRuntime,
  hasExplorerMetadataDocumentUpdateEvent,
  hydrateRemoteExplorerContainers,
  isDestroyedExplorerSyncRuntimeError,
  loadLocalExplorerContainerStates,
  primeExplorerDocumentsForContainerSubtree,
  registerExplorerSyncLane,
  syncExplorerContainerMetadataState,
  syncPendingExplorerContainerCreateIntents,
} from "../../workflows/explorer";
import { primeDocumentStore } from "../documents/DocumentsProvider";
import { createExplorerDocumentsRuntime } from "./documentRuntime";

type ExplorerAppData = ReturnType<typeof useAppData>;

export interface ExplorerRuntime {
  apiClient: ExplorerAppData["apiClient"];
  blobStore: BlobStore;
  cacheReferencedPrincipalPolicies: ExplorerAppData["cacheReferencedPrincipalPolicies"];
  dbStatus: ExplorerAppData["dbStatus"];
  domainScope: ExplorerAppData["domainScope"];
  encapsulationKeyPair: ExplorerAppData["encapsulationKeyPair"];
  events: ExplorerAppData["events"];
  execSql: ExplorerAppData["execSql"];
  isAuthenticated: ExplorerAppData["isAuthenticated"];
  log: ExplorerAppData["log"];
  online: ExplorerAppData["online"];
  organizationId?: ExplorerAppData["organizationId"];
  signingFingerprint?: ExplorerAppData["signingFingerprint"];
  signingKeyPair?: ExplorerAppData["signingKeyPair"];
  userId?: ExplorerAppData["userId"];
}

export type ContainerState = ExplorerContainerState;

export interface ExplorerSyncState {
  containersById: Map<string, ContainerState>;
  initializePromise: Promise<void> | null;
  initialized: boolean;
  lastEventCount: number;
  persistence: ExplorerPersistence;
  remoteHydrationPromise: Promise<void> | null;
  resolveProjectionUserKey: ExplorerProjectionUserKeyResolver;
  runtime: ExplorerRuntime;
  snapshot: {
    ready: boolean;
  };
  syncLane: ExplorerSyncLane | null;
}

export interface ExplorerSyncAgent {
  enqueuePendingContainerUpdate: (
    containerId: string,
    update: Uint8Array,
    sourceVersionVector?: string | null,
  ) => Promise<void>;
  ensureInitialized: () => void;
  handleRemoteEvents: () => void;
  ingestRemoteContainer: (
    remoteContainer: ExplorerRemoteContainer,
  ) => Promise<void>;
  primeDocumentsForSharedSubtree: (rootContainerId: string) => Promise<void>;
  refresh: () => Promise<boolean>;
  requestRemoteHydration: () => Promise<void>;
  scheduleRemoteHydration: () => void;
  scheduleSync: () => void;
}

type ExplorerSyncHost = ExplorerRemoteContainerHydrationHost;
type ExplorerPrimeDocumentRuntime = ReturnType<
  typeof createExplorerDocumentsRuntime
>;

function requestExplorerSync(state: ExplorerSyncState) {
  state.syncLane?.requestSync();
}

function createExplorerDocumentPrimeHost(
  state: ExplorerSyncState,
): ExplorerDocumentPrimeHost<ExplorerPrimeDocumentRuntime> {
  return {
    createDocumentRuntime: (containerId) =>
      createExplorerDocumentsRuntime(
        {
          ...state.runtime,
          organizationId: state.runtime.organizationId ?? null,
          resolveProjectionUserKey: state.resolveProjectionUserKey,
          signingFingerprint: state.runtime.signingFingerprint ?? null,
          signingKeyPair: state.runtime.signingKeyPair ?? null,
          userId: state.runtime.userId ?? null,
        },
        containerId,
      ),
    primeDocumentStore: ({
      documentId,
      localId,
      runtime,
    }): ExplorerDocumentPrimeStore =>
      primeDocumentStore(
        state.runtime.domainScope,
        localId,
        runtime,
        documentId,
      ),
  };
}

async function primeDocumentsForSharedSubtree(
  state: ExplorerSyncState,
  rootContainerId: string,
) {
  await primeExplorerDocumentsForContainerSubtree({
    containersById: state.containersById,
    host: createExplorerDocumentPrimeHost(state),
    rootContainerId,
    runtime: state.runtime,
  });
}

async function enqueuePendingContainerUpdate(
  state: ExplorerSyncState,
  containerId: string,
  update: Uint8Array,
  sourceVersionVector?: string | null,
) {
  await enqueuePendingExplorerContainerUpdateFromRuntime({
    containerId,
    persistence: state.persistence,
    runtime: state.runtime,
    sourceVersionVector,
    update,
  });
}

function requestRemoteHydration(input: {
  host: ExplorerSyncHost;
  scheduleSync: () => void;
  state: ExplorerSyncState;
}): Promise<void> {
  const { host, scheduleSync, state } = input;
  if (state.remoteHydrationPromise) {
    return state.remoteHydrationPromise;
  }

  state.remoteHydrationPromise = hydrateRemoteExplorerContainers({
    host,
    state,
  })
    .catch((error: unknown) => {
      if (isDestroyedExplorerSyncRuntimeError(error)) {
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

async function initializeExplorerStore(input: {
  host: ExplorerSyncHost;
  scheduleSync: () => void;
  state: ExplorerSyncState;
}) {
  const { host, scheduleSync, state } = input;
  if (state.runtime.dbStatus !== "ready") {
    return;
  }

  const localContainerStates = await loadLocalExplorerContainerStates({
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
    `Explorer: loaded ${state.containersById.size} container(s)`,
  );

  if (state.runtime.isAuthenticated && state.runtime.online) {
    await hydrateRemoteExplorerContainers({ host, state });
  }

  if (
    state.containersById.size > 0 ||
    (state.runtime.isAuthenticated && state.runtime.online)
  ) {
    scheduleSync();
  }
}

function ensureExplorerStoreInitialized(input: {
  host: ExplorerSyncHost;
  scheduleSync: () => void;
  state: ExplorerSyncState;
}) {
  const { host, scheduleSync, state } = input;
  if (
    state.initialized ||
    state.initializePromise ||
    state.runtime.dbStatus !== "ready"
  ) {
    return;
  }

  state.initializePromise = initializeExplorerStore({
    host,
    scheduleSync,
    state,
  }).catch((error: unknown) => {
    state.initializePromise = null;

    if (isDestroyedExplorerSyncRuntimeError(error)) {
      return;
    }

    throw error;
  });
}

async function syncSingleContainerMetadata(input: {
  host: ExplorerSyncHost;
  state: ExplorerSyncState;
  containerState: ContainerState;
  encapsulationKeyPair: NonNullable<ExplorerRuntime["encapsulationKeyPair"]>;
}) {
  const { containerState, encapsulationKeyPair, host, state } = input;
  const synced = await syncExplorerContainerMetadataState({
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
    requestExplorerSync(state);
  }
}

async function runExplorerSyncIteration(input: {
  host: ExplorerSyncHost;
  state: ExplorerSyncState;
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

  const createdContainerCount = await syncPendingExplorerContainerCreateIntents(
    {
      host,
      state,
    },
  );
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

export function createExplorerSyncAgent(input: {
  host: ExplorerSyncHost;
  state: ExplorerSyncState;
}): ExplorerSyncAgent {
  const { host, state } = input;

  state.syncLane = registerExplorerSyncLane({
    domainScope: state.runtime.domainScope,
    run: () => runExplorerSyncIteration({ host, state }),
  });
  const scheduleSync = () => requestExplorerSync(state);
  const ingestRemoteContainer = createRemoteExplorerContainerIngestor({
    host,
    state,
  });

  const requestHydration = () =>
    requestRemoteHydration({ host, scheduleSync, state });

  return {
    enqueuePendingContainerUpdate: (
      containerId: string,
      update: Uint8Array,
      sourceVersionVector?: string | null,
    ) =>
      enqueuePendingContainerUpdate(
        state,
        containerId,
        update,
        sourceVersionVector,
      ),
    ensureInitialized: () =>
      ensureExplorerStoreInitialized({ host, scheduleSync, state }),
    handleRemoteEvents: () => {
      const nextEvents = state.runtime.events.slice(state.lastEventCount);
      state.lastEventCount = state.runtime.events.length;

      if (
        hasExplorerMetadataDocumentUpdateEvent(
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

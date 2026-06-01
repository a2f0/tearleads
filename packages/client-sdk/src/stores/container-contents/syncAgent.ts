import { syncPendingContainerCreateIntents } from "../../workflows/container-contents/container-state/createIntentSync";
import { syncPendingContainerMoveIntents } from "../../workflows/container-contents/container-state/moveIntentSync";
import { listContainerParentIdsForEventHydration } from "../../workflows/container-contents/containerEvents";
import type { ContainerContentsPersistence } from "../../workflows/container-contents/containerPersistence";
import {
  type ContainerDocumentPrimeHost,
  type ContainerDocumentPrimeStore,
  primeDocumentsForContainerSubtree,
} from "../../workflows/container-contents/documentReadModel";
import { loadLocalContainerStates } from "../../workflows/container-contents/localState";
import {
  listContainerMetadataDocumentUpdateIds,
  syncContainerMetadataState,
} from "../../workflows/container-contents/metadata";
import type { ContainerContentsProjectionUserKeyResolver } from "../../workflows/container-contents/projectionKeys";
import {
  type ContainerState,
  createRemoteContainerIngestor,
  hydrateRemoteContainers,
  type RemoteContainer,
  type RemoteContainerHydrationHost,
} from "../../workflows/container-contents/remoteHydration";
import {
  type ContainerContentsWorkflowRuntime,
  createContainerContentsDocumentsRuntime,
} from "../../workflows/container-contents/runtime";
import {
  type ContainerContentsSyncLane,
  isDestroyedContainerContentsSyncRuntimeError,
  registerContainerContentsSyncLane,
} from "../../workflows/container-contents/syncLane";
import { primeDocumentStore, requestDomainDocumentSync } from "../documents";

export type { ContainerState };

export type ContainerContentsStoreRuntime = ContainerContentsWorkflowRuntime;

export interface ContainerContentsStoreSyncState {
  containersById: Map<string, ContainerState>;
  documentStoresNeedPriming: boolean;
  initializePromise: Promise<void> | null;
  initialized: boolean;
  lastEventCount: number;
  logLabel?: string | undefined;
  metadataDocumentIdsNeedingSync: Set<string>;
  containerParentIdsNeedingHydration: Set<string | null>;
  recentContainerMutationHydrationAt: number | null;
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
  typeof createContainerContentsDocumentsRuntime
>;

const RECENT_CONTAINER_MUTATION_HYDRATION_MS = 10_000;

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
      createContainerContentsDocumentsRuntime(state.runtime, containerId),
    primeDocumentStore: ({
      documentId,
      localId,
      runtime,
    }): ContainerDocumentPrimeStore =>
      primeDocumentStore(
        state.runtime.state.domainScope,
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

async function primeDocumentsForSharedRoots(
  state: ContainerContentsStoreSyncState,
) {
  const rootContainerIds = Array.from(state.containersById.values()).flatMap(
    (containerState) =>
      containerState.container.parentId === null
        ? [containerState.container.id]
        : [],
  );

  await Promise.all(
    rootContainerIds.map((rootContainerId) =>
      primeDocumentsForSharedSubtree(state, rootContainerId),
    ),
  );
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
  const parentIds =
    state.containerParentIdsNeedingHydration.size === 0
      ? undefined
      : Array.from(state.containerParentIdsNeedingHydration);
  state.containerParentIdsNeedingHydration.clear();

  state.remoteHydrationPromise = hydrateRemoteContainers({
    host,
    parentIds,
    state,
  })
    .then(() => {
      state.recentContainerMutationHydrationAt = parentIds ? Date.now() : null;
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
        state.runtime.auth.isAuthenticated &&
        state.runtime.state.online
      ) {
        scheduleSync();
      }
    });

  return state.remoteHydrationPromise;
}

function hasRecentContainerMutationHydration(
  state: ContainerContentsStoreSyncState,
): boolean {
  return (
    state.recentContainerMutationHydrationAt !== null &&
    Date.now() - state.recentContainerMutationHydrationAt <=
      RECENT_CONTAINER_MUTATION_HYDRATION_MS
  );
}

async function initializeContainerContentsStore(input: {
  host: ContainerContentsStoreSyncHost;
  scheduleSync: () => void;
  state: ContainerContentsStoreSyncState;
}) {
  const { host, scheduleSync, state } = input;
  if (state.runtime.infra.dbStatus !== "ready") {
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

  state.runtime.util.log(
    `${getContainerContentsStoreLogLabel(state)}: loaded ${state.containersById.size} container(s)`,
  );

  if (state.runtime.auth.isAuthenticated && state.runtime.state.online) {
    await hydrateRemoteContainers({ host, state });
  }

  if (
    state.containersById.size > 0 ||
    (state.runtime.auth.isAuthenticated && state.runtime.state.online)
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
    state.runtime.infra.dbStatus !== "ready"
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
    ContainerContentsStoreRuntime["crypto"]["encapsulationKeyPair"]
  >;
}) {
  const { containerState, encapsulationKeyPair, host, state } = input;
  const metadataDocumentId = containerState.record.documentId;
  const synced = await syncContainerMetadataState({
    forceReadSync:
      typeof metadataDocumentId === "string" &&
      state.metadataDocumentIdsNeedingSync.has(metadataDocumentId),
    metadataState: containerState,
    persistence: state.persistence,
    resolveProjectionUserKey: state.resolveProjectionUserKey,
    runtime: state.runtime,
    targetSecretKey: encapsulationKeyPair.secretKey,
  });
  if (!synced) {
    return;
  }

  if (typeof metadataDocumentId === "string") {
    state.metadataDocumentIdsNeedingSync.delete(metadataDocumentId);
  }
  if (typeof synced.record.documentId === "string") {
    state.metadataDocumentIdsNeedingSync.delete(synced.record.documentId);
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

  const createdContainerCount = await syncPendingContainerCreateIntents({
    host,
    state,
  });
  if (createdContainerCount > 0) {
    state.documentStoresNeedPriming = true;
    host.updateSnapshot();
  }

  const movedContainerCount = await syncPendingContainerMoveIntents({
    host,
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

  if (state.documentStoresNeedPriming) {
    await primeDocumentsForSharedRoots(state);
    state.documentStoresNeedPriming = false;
  }
}

export function createContainerContentsStoreSyncAgent(input: {
  host: ContainerContentsStoreSyncHost;
  state: ContainerContentsStoreSyncState;
}): ContainerContentsStoreSyncAgent {
  const { host, state } = input;

  state.syncLane = registerContainerContentsSyncLane({
    domainScope: state.runtime.state.domainScope,
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
      const nextEvents = state.runtime.state.events.slice(state.lastEventCount);
      state.lastEventCount = state.runtime.state.events.length;
      let addedContainerParentHydrationLane = false;
      for (const parentId of listContainerParentIdsForEventHydration(
        nextEvents,
        {
          ignoredSignerKeyFingerprint: state.runtime.crypto.signingFingerprint,
        },
      )) {
        if (!state.containerParentIdsNeedingHydration.has(parentId)) {
          addedContainerParentHydrationLane = true;
        }
        state.containerParentIdsNeedingHydration.add(parentId);
      }
      if (addedContainerParentHydrationLane) {
        void requestHydration();
      }
      const metadataDocumentIds = listContainerMetadataDocumentUpdateIds(
        nextEvents,
        state.containersById.values(),
      );
      for (const metadataDocumentId of metadataDocumentIds) {
        state.metadataDocumentIdsNeedingSync.add(metadataDocumentId);
      }

      if (metadataDocumentIds.length > 0) {
        scheduleSync();
      }
    },
    ingestRemoteContainer,
    primeDocumentsForSharedSubtree: (rootContainerId: string) =>
      primeDocumentsForSharedSubtree(state, rootContainerId),
    refresh: () => {
      if (
        state.runtime.infra.dbStatus !== "ready" ||
        !state.initialized ||
        !state.runtime.auth.isAuthenticated ||
        !state.runtime.state.online
      ) {
        return Promise.resolve(false);
      }

      if (
        state.containerParentIdsNeedingHydration.size === 0 &&
        hasRecentContainerMutationHydration(state)
      ) {
        state.recentContainerMutationHydrationAt = null;
        return Promise.resolve(true);
      }

      return requestHydration().then(() => {
        state.recentContainerMutationHydrationAt = null;
        return true;
      });
    },
    requestRemoteHydration: requestHydration,
    scheduleRemoteHydration: () => {
      void requestHydration();
    },
    scheduleSync,
  };
}

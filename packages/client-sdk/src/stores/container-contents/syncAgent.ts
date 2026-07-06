import { syncPendingContainerCreateIntents } from "../../workflows/container-contents/container-state/createIntentSync";
import { syncPendingContainerMoveIntents } from "../../workflows/container-contents/container-state/moveIntentSync";
import { listContainerParentIdsForEventHydration } from "../../workflows/container-contents/containerEvents";
import type { ContainerContentsPersistence } from "../../workflows/container-contents/containerPersistence";
import {
  type DocumentMoveIntentSyncHost,
  syncPendingDocumentMoveIntents,
} from "../../workflows/container-contents/documentMoveIntentSync";
import {
  type ContainerDocumentPrimeHost,
  type ContainerDocumentPrimeStore,
  primeDocumentsForContainerSubtree,
} from "../../workflows/container-contents/documentQueries";
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
  isDestroyedDatabaseClientError,
  registerContainerContentsSyncLane,
} from "../../workflows/container-contents/syncLane";
import { openDocumentStore, requestDomainDocumentSync } from "../documents";
import {
  bumpMetadataSyncSeq,
  clearMetadataSyncQueueIfUnchanged,
  readMetadataSyncSeq,
} from "./metadataSyncSignal";
import {
  refreshAllRemoteHydration,
  refreshRootRemoteHydration,
} from "./remoteHydrationRefresh";
import {
  hasStartupContainerSyncWork,
  scheduleStaleStartupRemoteHydration,
} from "./startupHydration";

export type { ContainerState };

export type ContainerContentsStoreRuntime = ContainerContentsWorkflowRuntime;

export interface ContainerContentsStoreSyncState {
  containersById: Map<string, ContainerState>;
  documentStoresNeedPriming: boolean;
  initializePromise: Promise<void> | null;
  initialized: boolean;
  lastEventCount: number;
  /**
   * Update ids this client sent for container metadata documents, registered
   * before the network await of each metadata sync pass. The author's own
   * `document_update_created` echo consumes its ids here instead of arming a
   * redundant forced read-sync; a genuine peer update always carries unknown
   * ids and still forces one. Shared across all metadata docs in the store —
   * update ids are globally unique.
   */
  locallyAcceptedMetadataUpdateIds: Set<string>;
  logLabel?: string | undefined;
  metadataDocumentIdsNeedingSync: Set<string>;
  /**
   * Per-metadata-document enqueue sequence. Bumped for a specific id whenever a
   * remote event re-queues it in {@link metadataDocumentIdsNeedingSync}. A sync
   * pass snapshots the id's sequence before its GET and only clears the id if it
   * is unchanged at pass end, so a mid-pass re-queue of THIS container is not
   * erased. Keyed per id (not a single global counter) so a remote event for an
   * unrelated container does not force a redundant re-sync of this one. See
   * {@link clearMetadataSyncQueueIfUnchanged}.
   */
  metadataSyncSignalSeqById: Map<string, number>;
  containerParentIdsNeedingHydration: Set<string | null>;
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
  refreshRootLane: () => Promise<boolean>;
  requestRemoteHydration: (options?: {
    followDiscoveredParentLanes?: boolean | undefined;
    parentIds?: ReadonlyArray<string | null> | undefined;
  }) => Promise<void>;
  scheduleRemoteHydration: () => void;
  scheduleSync: () => void;
}

type ContainerContentsStoreSyncHost = RemoteContainerHydrationHost;
type ContainerContentsStorePrimeDocumentRuntime = ReturnType<
  typeof createContainerContentsDocumentsRuntime
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

function isRemoteSyncBlocked(state: ContainerContentsStoreSyncState): boolean {
  return state.runtime.util.isRemoteSyncBlocked?.() ?? false;
}

function createContainerContentsStoreDocumentPrimeHost(
  state: ContainerContentsStoreSyncState,
): ContainerDocumentPrimeHost<ContainerContentsStorePrimeDocumentRuntime> {
  return {
    documentWorkflowRuntime: (containerId) =>
      createContainerContentsDocumentsRuntime(state.runtime, containerId),
    openDocumentStore: ({
      documentId,
      localId,
      runtime,
    }): ContainerDocumentPrimeStore =>
      openDocumentStore(
        state.runtime.state.domainScope,
        localId,
        runtime,
        documentId,
      ),
  };
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
  followDiscoveredParentLanes?: boolean | undefined;
  host: ContainerContentsStoreSyncHost;
  parentIds?: ReadonlyArray<string | null> | undefined;
  resetRootLaneWatermark?: boolean | undefined;
  scheduleSyncAfterHydration?: boolean | undefined;
  scheduleSync: () => void;
  state: ContainerContentsStoreSyncState;
}): Promise<void> {
  const { host, scheduleSync, state } = input;
  if (input.parentIds) {
    for (const parentId of input.parentIds) {
      state.containerParentIdsNeedingHydration.add(parentId);
    }
  }

  if (state.remoteHydrationPromise) {
    const requestQueuedHydration = () =>
      state.containerParentIdsNeedingHydration.size > 0
        ? requestRemoteHydration(input)
        : undefined;
    return state.remoteHydrationPromise.then(
      requestQueuedHydration,
      (error: unknown) => requestQueuedHydration() ?? Promise.reject(error),
    );
  }
  const queuedParentIds = Array.from(state.containerParentIdsNeedingHydration);
  const followDiscoveredParentLanes =
    input.followDiscoveredParentLanes ?? queuedParentIds.length === 0;
  const parentIds = followDiscoveredParentLanes
    ? undefined
    : queuedParentIds.length === 0
      ? undefined
      : queuedParentIds;
  state.containerParentIdsNeedingHydration.clear();

  let appliedRemoteContainerChange = false;
  state.remoteHydrationPromise = hydrateRemoteContainers({
    followDiscoveredParentLanes,
    host,
    parentIds,
    resetRootLaneWatermark: input.resetRootLaneWatermark,
    state,
  })
    .then((changedCount) => {
      appliedRemoteContainerChange = changedCount > 0;
    })
    .catch((error: unknown) => {
      if (isDestroyedDatabaseClientError(error)) {
        return;
      }

      throw error;
    })
    .finally(() => {
      state.remoteHydrationPromise = null;

      if (
        (appliedRemoteContainerChange || input.scheduleSyncAfterHydration) &&
        state.snapshot.ready &&
        state.runtime.auth.isAuthenticated &&
        state.runtime.state.online &&
        !isRemoteSyncBlocked(state)
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

  await scheduleStaleStartupRemoteHydration({
    requestHydration: () =>
      requestRemoteHydration({ host, scheduleSync, state }),
    state,
  });

  host.updateSnapshot();

  state.runtime.util.log(
    `${getContainerContentsStoreLogLabel(state)}: loaded ${state.containersById.size} container(s)`,
  );

  if (
    state.containersById.size > 0 &&
    !isRemoteSyncBlocked(state) &&
    (await hasStartupContainerSyncWork(state))
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

    if (isDestroyedDatabaseClientError(error)) {
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
  host: ContainerContentsStoreSyncHost;
  state: ContainerContentsStoreSyncState;
}) {
  const { host, state } = input;
  const encapsulationKeyPair = state.runtime.crypto.encapsulationKeyPair;
  if (
    state.runtime.infra.dbStatus !== "ready" ||
    !state.snapshot.ready ||
    !state.runtime.state.online ||
    isRemoteSyncBlocked(state) ||
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

  // Document move intents live in the structural phase because they may target
  // containers created locally in the same session, such as Trash. Running them
  // here lets container create/move intents settle before document lanes sync.
  const movedDocumentCount = await syncPendingDocumentMoveIntents({
    host: createContainerContentsStoreDocumentMoveHost(state),
    state,
  });
  if (movedDocumentCount > 0) {
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

  const requestHydration: ContainerContentsStoreSyncAgent["requestRemoteHydration"] =
    (options = {}) =>
      requestRemoteHydration({
        followDiscoveredParentLanes: options.followDiscoveredParentLanes,
        host,
        parentIds: options.parentIds,
        scheduleSync,
        state,
      });
  const requestRefreshHydration = (options: {
    followDiscoveredParentLanes?: boolean | undefined;
    parentIds?: ReadonlyArray<string | null> | undefined;
    resetRootLaneWatermark?: boolean | undefined;
    scheduleSyncAfterHydration?: boolean | undefined;
  }) => requestRemoteHydration({ ...options, host, scheduleSync, state });

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
        state.locallyAcceptedMetadataUpdateIds,
      );
      for (const metadataDocumentId of metadataDocumentIds) {
        state.metadataDocumentIdsNeedingSync.add(metadataDocumentId);
        // Bump this id's sequence so an in-flight pass syncing this same
        // container detects the fresh re-queue and does not clear it.
        bumpMetadataSyncSeq(
          state.metadataSyncSignalSeqById,
          metadataDocumentId,
        );
      }

      if (metadataDocumentIds.length > 0) {
        scheduleSync();
      }
    },
    ingestRemoteContainer,
    primeDocumentsForSharedSubtree: (rootContainerId: string) =>
      primeDocumentsForSharedSubtree(state, rootContainerId),
    refresh: () =>
      refreshAllRemoteHydration({
        requestHydration: requestRefreshHydration,
        state,
      }),
    refreshRootLane: () =>
      refreshRootRemoteHydration({
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

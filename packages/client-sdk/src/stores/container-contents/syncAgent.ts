import { syncPendingContainerCreateIntents } from "../../workflows/container-contents/container-state/createIntentSync";
import { syncPendingContainerMoveIntents } from "../../workflows/container-contents/container-state/moveIntentSync";
import { listContainerParentIdsForEventHydration } from "../../workflows/container-contents/containerEvents";
import type { ContainerContentsPersistence } from "../../workflows/container-contents/containerPersistence";
import {
  type DocumentMoveIntentSyncHost,
  syncPendingDocumentMoveIntents,
} from "../../workflows/container-contents/documentMoveIntentSync";
import { loadLocalContainerStates } from "../../workflows/container-contents/localState";
import {
  listContainerMetadataDocumentUpdateIds,
  syncContainerMetadataState,
} from "../../workflows/container-contents/metadata";
import type { ContainerContentsProjectionUserKeyResolver } from "../../workflows/container-contents/projectionKeys";
import {
  type ContainerState,
  createRemoteContainerIngestor,
  type RemoteContainer,
  type RemoteContainerHydrationHost,
} from "../../workflows/container-contents/remoteHydration";
import {
  type ContainerContentsStoreWorkflowRuntime,
  createContainerContentsDocumentsRuntime,
} from "../../workflows/container-contents/runtime";
import {
  type ContainerContentsSyncLane,
  isDatabaseUnavailableError,
  registerContainerContentsSyncLane,
} from "../../workflows/container-contents/syncLane";
import { reclaimDocumentOrphanBlobs } from "../../workflows/documents";
import { openDocumentStore, requestDomainDocumentSync } from "../documents";
import {
  primeStoreDocumentSubtree,
  primeStoreDocuments,
  recoverStoreStaleRoot,
} from "./documentRecovery";
import { runContainerDocumentWork } from "./documentWork";
import { refreshLocalContainerStates } from "./localRefresh";
import {
  bumpMetadataSyncSeq,
  clearMetadataSyncQueueIfUnchanged,
  readMetadataSyncSeq,
} from "./metadataSyncSignal";
import {
  refreshAllRemoteHydration,
  refreshRootRemoteHydration,
} from "./remoteHydrationRefresh";
import { requestContainerContentsRemoteHydration } from "./remoteHydrationRequest";
import {
  hasStartupContainerSyncWork,
  scheduleStaleStartupRemoteHydration,
} from "./startupHydration";

export type { ContainerState };

export type ContainerContentsStoreRuntime =
  ContainerContentsStoreWorkflowRuntime;

export interface ContainerContentsStoreSyncState {
  containersById: Map<string, ContainerState>;
  documentStoresNeedPriming: boolean;
  initializePromise: Promise<void> | null;
  initialized: boolean;
  localContainerRefreshPromise: Promise<void> | null;
  localContainersNeedRefresh: boolean;
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
  /** True after this store has fully applied an authoritative root lane. */
  rootLaneHydrated: boolean;
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
  host: ContainerContentsStoreSyncHost;
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
  host: ContainerContentsStoreSyncHost;
  scheduleSync: () => void;
  state: ContainerContentsStoreSyncState;
}) {
  const { host, scheduleSync, state } = input;
  if (state.runtime.infra.dbStatus !== "ready") {
    return;
  }

  await reclaimDocumentOrphanBlobs(state.runtime);
  const localContainerStates = await loadLocalContainerStates({
    persistence: state.persistence,
    runtime: state.runtime,
  });

  for (const containerState of localContainerStates) {
    state.containersById.set(containerState.container.id, containerState);
  }

  state.initialized = true;
  state.initializePromise = null;

  const shouldScheduleStaleRootRecovery =
    await scheduleStaleStartupRemoteHydration({
      requestHydration: () =>
        requestContainerContentsRemoteHydration({
          host,
          scheduleSync,
          state,
        }),
      state,
    });

  host.updateSnapshot();

  state.runtime.util.log(
    `${getContainerContentsStoreLogLabel(state)}: loaded ${state.containersById.size} container(s)`,
  );

  if (
    state.runtime.auth.isAuthenticated &&
    state.runtime.state.online &&
    (shouldScheduleStaleRootRecovery ||
      (await hasStartupContainerSyncWork(state)))
  ) {
    state.runtime.util.log(
      shouldScheduleStaleRootRecovery
        ? `${getContainerContentsStoreLogLabel(state)}: startup detected stale root recovery; scheduling lane pass`
        : `${getContainerContentsStoreLogLabel(state)}: startup detected durable sync work; scheduling lane pass`,
    );
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

    if (isDatabaseUnavailableError(error)) {
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
    !state.runtime.auth.isAuthenticated ||
    !encapsulationKeyPair
  ) {
    return;
  }
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
  host: ContainerContentsStoreSyncHost;
  state: ContainerContentsStoreSyncState;
}): ContainerContentsStoreSyncAgent {
  const { host, state } = input;

  state.syncLane = registerContainerContentsSyncLane({
    domainScope: state.runtime.state.domainScope,
    run: () => runContainerContentsStoreSyncIteration({ host, state }),
  });
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
  const requestRefreshHydration = (options: {
    followDiscoveredParentLanes?: boolean | undefined;
    parentIds?: ReadonlyArray<string | null> | undefined;
    resetRootLaneWatermark?: boolean | undefined;
    scheduleSyncAfterHydration?: boolean | undefined;
  }) =>
    requestContainerContentsRemoteHydration({
      ...options,
      host,
      scheduleSync,
      state,
    });

  return {
    ensureInitialized: () =>
      ensureContainerContentsStoreInitialized({ host, scheduleSync, state }),
    handleRemoteEvents: () => {
      const nextEvents = state.runtime.state.events.slice(state.lastEventCount);
      state.lastEventCount = state.runtime.state.events.length;
      let addedContainerParentHydrationLane = false;
      for (const parentId of listContainerParentIdsForEventHydration(
        nextEvents,
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

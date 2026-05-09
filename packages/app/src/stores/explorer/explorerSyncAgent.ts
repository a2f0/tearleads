import type { BlobStore } from "../../data/blobs";
import { isDocumentUpdateCreatedEvent } from "../../data/documentSync";
import type { ProjectionUserKeyResolver } from "../../data/keyingProjectionVerification";
import {
  getOrCreateDomainSyncCoordinator,
  isDestroyedDatabaseClientError,
  type SyncLane,
} from "../../data/sync/syncCoordinator";
import type { useAppData } from "../../providers/data/AppDataProvider";
import {
  type ExplorerContainerMetadataDocument,
  type ExplorerContainerState,
  type ExplorerPersistence,
  type ExplorerRemoteContainer,
  type ExplorerRemoteContainerHydrationHost,
  enqueuePendingExplorerContainerUpdate,
  hydrateRemoteExplorerContainers,
  listExplorerDocumentsForContainerSubtree,
  loadLocalExplorerContainerStates,
  syncExplorerContainerMetadataState,
  syncPendingExplorerContainerCreateIntents,
  upsertRemoteExplorerContainerState,
} from "../../workflows/explorer";
import { primeDocumentStore } from "../documents/DocumentsProvider";
import { createExplorerDocumentsRuntime } from "./documentRuntime";

type ExplorerAppData = ReturnType<typeof useAppData>;

export type ContainerMetadataDocument = ExplorerContainerMetadataDocument;

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
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ExplorerRuntime;
  snapshot: {
    ready: boolean;
  };
  syncLane: SyncLane | null;
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

function requestExplorerSync(state: ExplorerSyncState) {
  state.syncLane?.requestSync();
}

function resolveSharedDocumentRuntimeContainerId(params: {
  linkedContainerIdsByDocumentId: ReadonlyMap<string, ReadonlyArray<string>>;
  documentSummary: {
    containerId: string | null;
    documentId: string | null;
  };
  sharedContainerIds: ReadonlySet<string>;
}): string | null {
  const {
    linkedContainerIdsByDocumentId,
    documentSummary,
    sharedContainerIds,
  } = params;
  if (
    documentSummary.containerId &&
    sharedContainerIds.has(documentSummary.containerId)
  ) {
    return documentSummary.containerId;
  }

  if (!documentSummary.documentId) {
    return null;
  }

  return (
    linkedContainerIdsByDocumentId
      .get(documentSummary.documentId)
      ?.find((containerId) => sharedContainerIds.has(containerId)) ?? null
  );
}

function isContainerInSubtree(
  containersById: ReadonlyMap<string, ContainerState>,
  containerId: string,
  rootContainerId: string,
): boolean {
  let currentId: string | null = containerId;

  while (currentId !== null) {
    if (currentId === rootContainerId) {
      return true;
    }

    currentId = containersById.get(currentId)?.container.parentId ?? null;
  }

  return false;
}

async function primeDocumentsForSharedSubtree(
  state: ExplorerSyncState,
  rootContainerId: string,
) {
  const sharedContainerIds = new Set(
    Array.from(state.containersById.values())
      .filter((containerState) =>
        isContainerInSubtree(
          state.containersById,
          containerState.container.id,
          rootContainerId,
        ),
      )
      .map((containerState) => containerState.container.id),
  );

  if (sharedContainerIds.size === 0) {
    return;
  }

  const sharedContainerIdList = Array.from(sharedContainerIds);
  const { documentSummaries, linkedContainerIdsByDocumentId } =
    await listExplorerDocumentsForContainerSubtree(
      state.runtime.execSql,
      sharedContainerIdList,
    );

  for (const documentSummary of documentSummaries) {
    const runtimeContainerId = resolveSharedDocumentRuntimeContainerId({
      linkedContainerIdsByDocumentId,
      documentSummary,
      sharedContainerIds,
    });
    if (!runtimeContainerId) {
      continue;
    }

    const documentStore = primeDocumentStore(
      state.runtime.domainScope,
      documentSummary.id,
      createExplorerDocumentsRuntime(
        {
          ...state.runtime,
          organizationId: state.runtime.organizationId ?? null,
          resolveProjectionUserKey: state.resolveProjectionUserKey,
          signingFingerprint: state.runtime.signingFingerprint ?? null,
          signingKeyPair: state.runtime.signingKeyPair ?? null,
          userId: state.runtime.userId ?? null,
        },
        runtimeContainerId,
      ),
      documentSummary.documentId,
    );
    documentStore.requestSync();
  }
}

async function enqueuePendingContainerUpdate(
  state: ExplorerSyncState,
  containerId: string,
  update: Uint8Array,
  sourceVersionVector?: string | null,
) {
  await enqueuePendingExplorerContainerUpdate(
    state.runtime.execSql,
    state.persistence,
    {
      containerId,
      ...(sourceVersionVector === undefined ? {} : { sourceVersionVector }),
      update,
    },
  );
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
      if (isDestroyedDatabaseClientError(error)) {
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

    if (isDestroyedDatabaseClientError(error)) {
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

function createRemoteContainerIngestor(input: {
  host: ExplorerSyncHost;
  state: ExplorerSyncState;
}): (remoteContainer: ExplorerRemoteContainer) => Promise<void> {
  const { host, state } = input;
  const pendingRemoteContainersById = new Map<
    string,
    ExplorerRemoteContainer
  >();
  let ingestRemoteContainersPromise: Promise<void> | null = null;

  return async (remoteContainer: ExplorerRemoteContainer) => {
    pendingRemoteContainersById.set(remoteContainer.id, remoteContainer);

    if (ingestRemoteContainersPromise) {
      return ingestRemoteContainersPromise;
    }

    ingestRemoteContainersPromise = Promise.resolve()
      .then(async () => {
        while (pendingRemoteContainersById.size > 0) {
          const queuedRemoteContainers = Array.from(
            pendingRemoteContainersById.values(),
          );
          pendingRemoteContainersById.clear();

          await state.runtime.cacheReferencedPrincipalPolicies(
            queuedRemoteContainers.flatMap(
              (queuedRemoteContainer) =>
                queuedRemoteContainer.metadataReferencedPrincipals ?? [],
            ),
          );

          for (const queuedRemoteContainer of queuedRemoteContainers) {
            await upsertRemoteExplorerContainerState({
              host,
              remoteContainer: queuedRemoteContainer,
              state,
            });
          }

          host.updateSnapshot();
        }
      })
      .finally(() => {
        ingestRemoteContainersPromise = null;
      });

    return ingestRemoteContainersPromise;
  };
}

export function createExplorerSyncAgent(input: {
  host: ExplorerSyncHost;
  state: ExplorerSyncState;
}): ExplorerSyncAgent {
  const { host, state } = input;

  state.syncLane = getOrCreateDomainSyncCoordinator(
    state.runtime.domainScope,
  ).registerLane("explorer", {
    run: () => runExplorerSyncIteration({ host, state }),
    shouldIgnoreError: isDestroyedDatabaseClientError,
  });
  const scheduleSync = () => requestExplorerSync(state);
  const ingestRemoteContainer = createRemoteContainerIngestor({ host, state });

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
      const knownDocumentIds = new Set(
        Array.from(
          state.containersById.values(),
          (containerState) => containerState.record.documentId,
        ).filter((documentId) => documentId !== null),
      );

      if (knownDocumentIds.size === 0) {
        state.lastEventCount = state.runtime.events.length;
        return;
      }

      const nextEvents = state.runtime.events.slice(state.lastEventCount);
      state.lastEventCount = state.runtime.events.length;

      if (
        nextEvents.some(
          (event) =>
            isDocumentUpdateCreatedEvent(event) &&
            knownDocumentIds.has(event.documentId),
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

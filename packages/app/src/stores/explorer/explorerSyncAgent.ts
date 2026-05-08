import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import {
  encodeVersionVector,
  exportAllUpdates,
  importUpdates,
} from "@tearleads/loro";
import type { BlobStore } from "../../data/blobs";
import {
  createContainerMetadataDocument,
  getDefaultContainerName,
  readContainerMetadataValue,
  writeContainerMetadataValue,
} from "../../data/containers";
import { isDocumentUpdateCreatedEvent } from "../../data/documentSync";
import type { ProjectionUserKeyResolver } from "../../data/keyingProjectionVerification";
import {
  getOrCreateDomainSyncCoordinator,
  isDestroyedDatabaseClientError,
  type SyncLane,
} from "../../data/sync/syncCoordinator";
import type { useAppData } from "../../providers/data/AppDataProvider";
import {
  type ContainerCreateIntentRecord,
  createRemoteExplorerContainer,
  type ExplorerContainerMetadataDocument,
  type ExplorerContainerState,
  type ExplorerMetadataSyncAttempt,
  type ExplorerPendingUpdateRecord,
  type ExplorerPersistence,
  type ExplorerRemoteContainer,
  type ExplorerRemoteContainerHydrationHost,
  enqueuePendingExplorerContainerUpdate,
  hydrateRemoteExplorerContainers,
  initializeExplorerSchema,
  listExplorerDocumentsForContainerSubtree,
  listPendingExplorerContainerCreateIntents,
  listPendingExplorerContainerUpdates,
  loadStoredExplorerContainers,
  markExplorerContainerCreateIntentSynced,
  persistExplorerContainerMetadataState,
  recordExplorerContainerCreateIntentError,
  type StoredExplorerContainer,
  saveExplorerContainer,
  syncRemoteExplorerContainerMetadata,
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

async function listPendingContainerUpdates(
  state: ExplorerSyncState,
  containerId: string,
): Promise<ExplorerPendingUpdateRecord[]> {
  return listPendingExplorerContainerUpdates(
    state.runtime.execSql,
    state.persistence,
    containerId,
  );
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

  await initializeExplorerSchema(state.runtime.execSql, state.persistence);
  const storedContainers: ReadonlyArray<StoredExplorerContainer> =
    await loadStoredExplorerContainers(
      state.runtime.execSql,
      state.persistence,
    );

  for (const storedContainer of storedContainers) {
    const { container } = storedContainer;
    const doc = await createContainerMetadataDocument(container.id);
    let nextContainer = container;
    let nextRecord = storedContainer.record;

    if (nextRecord?.loroSnapshot) {
      importUpdates(doc, [base64ToBytes(nextRecord.loroSnapshot)]);
      const metadata = readContainerMetadataValue(
        doc,
        getDefaultContainerName(container.parentId),
      );
      nextContainer = {
        ...container,
        icon: metadata.icon,
        name: metadata.name,
      };
      await saveExplorerContainer(
        state.runtime.execSql,
        state.persistence,
        nextContainer,
        nextRecord,
      );
    } else {
      writeContainerMetadataValue(doc, {
        icon: container.icon,
        name: container.name,
      });
      const initialUpdate = exportAllUpdates(doc);
      nextRecord = {
        accessEpoch: 1,
        accessStateHash: null,
        documentId: container.metadataDocumentId,
        id: container.id,
        lastCommitLsn: null,
        loroSnapshot: bytesToBase64(initialUpdate),
        contentKeyBundle: null,
        documentKekTargets: null,
        documentManifestBundle: null,
      };
      await saveExplorerContainer(
        state.runtime.execSql,
        state.persistence,
        nextContainer,
        nextRecord,
      );

      if (!container.metadataDocumentId) {
        await enqueuePendingContainerUpdate(state, container.id, initialUpdate);
      }
    }

    state.containersById.set(container.id, {
      container: nextContainer,
      doc,
      record: nextRecord,
    });
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

async function applySyncedContainerUpdates(input: {
  containerState: ContainerState;
  synced: ExplorerMetadataSyncAttempt["synced"];
}) {
  const { containerState, synced } = input;

  if (synced.decryptedUpdates.length > 0) {
    importUpdates(
      containerState.doc,
      synced.decryptedUpdates.map((update) => update.updateData),
    );
  }
}

async function requestContainerMetadataSync(
  state: ExplorerSyncState,
  containerState: ContainerState,
  encapsulationKeyPair: NonNullable<ExplorerRuntime["encapsulationKeyPair"]>,
): Promise<ExplorerMetadataSyncAttempt | null> {
  const { documentId } = containerState.record;
  if (!documentId) {
    return null;
  }

  const pendingUpdates = await listPendingContainerUpdates(
    state,
    containerState.container.id,
  );

  return syncRemoteExplorerContainerMetadata({
    containerId: containerState.container.id,
    documentId,
    lastCommitLsn: containerState.record.lastCommitLsn,
    localVersionVector: encodeVersionVector(containerState.doc),
    pendingUpdates,
    resolveProjectionUserKey: state.resolveProjectionUserKey,
    runtime: state.runtime,
    targetSecretKey: encapsulationKeyPair.secretKey,
  });
}

async function syncSingleContainerMetadata(input: {
  host: ExplorerSyncHost;
  state: ExplorerSyncState;
  containerState: ContainerState;
  encapsulationKeyPair: NonNullable<ExplorerRuntime["encapsulationKeyPair"]>;
}) {
  const { containerState, encapsulationKeyPair, host, state } = input;
  const syncAttempt = await requestContainerMetadataSync(
    state,
    containerState,
    encapsulationKeyPair,
  );
  if (!syncAttempt) {
    return;
  }

  const { outgoingUpdateCount, synced } = syncAttempt;

  await applySyncedContainerUpdates({
    containerState,
    synced,
  });

  const persisted = await persistExplorerContainerMetadataState({
    acceptedPendingUpdateIds: synced.response.acceptedOutgoingUpdateIds,
    execSql: state.runtime.execSql,
    metadataState: containerState,
    patch: {
      ...synced.persistedState,
      documentId: containerState.record.documentId,
      lastCommitLsn:
        synced.response.commitLsn ??
        containerState.record.lastCommitLsn ??
        null,
      metadataDocumentId: containerState.record.documentId,
    },
    persistence: state.persistence,
  });
  containerState.container = persisted.container;
  containerState.record = persisted.record;
  host.updateSnapshot();

  if (outgoingUpdateCount > synced.response.acceptedOutgoingUpdateIds.length) {
    requestExplorerSync(state);
  }
}

function hasRemoteMetadataState(containerState: ContainerState): boolean {
  return (
    typeof containerState.record.documentId === "string" &&
    containerState.record.documentId.length > 0 &&
    typeof containerState.record.accessStateHash === "string" &&
    containerState.record.accessStateHash.length > 0
  );
}

async function markCreateIntentAlreadySynced(input: {
  intent: ContainerCreateIntentRecord;
  state: ExplorerSyncState;
  containerState: ContainerState;
}) {
  const { containerState, intent, state } = input;
  const remoteMetadataDocumentId = containerState.record.documentId;
  const remoteMetadataAccessStateHash = containerState.record.accessStateHash;

  if (!remoteMetadataDocumentId || !remoteMetadataAccessStateHash) {
    return;
  }

  await markExplorerContainerCreateIntentSynced(
    state.runtime.execSql,
    state.persistence,
    {
      containerId: intent.containerId,
      remoteContainerId: containerState.container.id,
      remoteMetadataAccessStateHash,
      remoteMetadataDocumentId,
    },
  );
}

async function persistCreatedContainerFromIntent(input: {
  created: NonNullable<
    Awaited<ReturnType<typeof createRemoteExplorerContainer>>
  >;
  host: ExplorerSyncHost;
  state: ExplorerSyncState;
  containerState: ContainerState;
}) {
  const { containerState, created, host, state } = input;

  const nextRecord = await host.persistContainerState(
    containerState,
    {
      accessEpoch: 1,
      accessStateHash: created.accessManifestHash,
      lastCommitLsn: null,
      metadataDocumentId: created.metadataDocumentId,
      organizationId: created.organizationId,
      parentId: created.parentId,
      ...created.persistedMetadataState,
    },
    false,
  );

  containerState.record = nextRecord;
  containerState.container = {
    ...containerState.container,
    metadataDocumentId: created.metadataDocumentId,
    organizationId: created.organizationId,
    parentId: created.parentId,
  };

  await markExplorerContainerCreateIntentSynced(
    state.runtime.execSql,
    state.persistence,
    {
      containerId: containerState.container.id,
      remoteContainerId: created.containerId,
      remoteMetadataAccessStateHash: created.accessManifestHash,
      remoteMetadataDocumentId: created.metadataDocumentId,
    },
  );
}

async function tryCreateRemoteContainerFromIntent(input: {
  host: ExplorerSyncHost;
  intent: ContainerCreateIntentRecord;
  state: ExplorerSyncState;
}): Promise<"created" | "blocked" | "failed"> {
  const { host, intent, state } = input;
  const containerState = state.containersById.get(intent.containerId);
  const parentState = state.containersById.get(intent.parentContainerId);

  if (!containerState || !parentState) {
    await recordExplorerContainerCreateIntentError(
      state.runtime.execSql,
      state.persistence,
      intent.containerId,
      "Container create intent references a missing local container",
    );
    return "failed";
  }

  if (hasRemoteMetadataState(containerState)) {
    await markCreateIntentAlreadySynced({ containerState, intent, state });
    return "created";
  }

  if (!hasRemoteMetadataState(parentState)) {
    return "blocked";
  }
  const created = await createRemoteExplorerContainer({
    containerId: containerState.container.id,
    parentContainerId: parentState.container.id,
    resolveProjectionUserKey: state.resolveProjectionUserKey,
    runtime: state.runtime,
  });

  if (!created) {
    await recordExplorerContainerCreateIntentError(
      state.runtime.execSql,
      state.persistence,
      intent.containerId,
      "Remote container create was rejected or unavailable",
    );
    return "failed";
  }

  await persistCreatedContainerFromIntent({
    containerState,
    created,
    host,
    state,
  });
  state.runtime.log(
    `Explorer: synced local container create ${containerState.container.id}`,
  );
  return "created";
}

async function syncPendingContainerCreateIntents(input: {
  host: ExplorerSyncHost;
  state: ExplorerSyncState;
}): Promise<number> {
  const { host, state } = input;
  const pendingIntents = await listPendingExplorerContainerCreateIntents(
    state.runtime.execSql,
    state.persistence,
  );
  const remainingContainerIds = new Set(
    pendingIntents.map((intent) => intent.containerId),
  );
  const failedThisRun = new Set<string>();
  let createdCount = 0;
  let progressed = true;

  while (progressed) {
    progressed = false;

    for (const intent of pendingIntents) {
      if (
        !remainingContainerIds.has(intent.containerId) ||
        failedThisRun.has(intent.containerId)
      ) {
        continue;
      }

      const result = await tryCreateRemoteContainerFromIntent({
        host,
        intent,
        state,
      });

      if (result === "blocked") {
        continue;
      }

      remainingContainerIds.delete(intent.containerId);
      progressed = result === "created" || progressed;
      if (result === "created") {
        createdCount += 1;
      } else {
        failedThisRun.add(intent.containerId);
      }
    }
  }

  return createdCount;
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

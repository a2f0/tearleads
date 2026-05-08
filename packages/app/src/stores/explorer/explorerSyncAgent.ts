import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import {
  encodeVersionVector,
  exportAllUpdates,
  importUpdates,
} from "@tearleads/loro";
import type {
  ContainerSummary,
  ContainerSyncTombstone,
} from "@tearleads/validators/response";
import type { BlobStore } from "../../data/blobs";
import {
  createContainerMetadataDocument,
  getDefaultContainerName,
  readContainerMetadataValue,
  writeContainerMetadataValue,
} from "../../data/containers";
import { isDocumentUpdateCreatedEvent } from "../../data/documentSync";
import type { ProjectionUserKeyResolver } from "../../data/keyingProjectionVerification";
import type {
  DocumentRecord,
  PendingUpdateRecord,
} from "../../data/sqlite/documentPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import {
  getOrCreateDomainSyncCoordinator,
  isDestroyedDatabaseClientError,
  type SyncLane,
} from "../../data/sync/syncCoordinator";
import type { useAppData } from "../../providers/data/AppDataProvider";
import {
  type ContainerCreateIntentRecord,
  type ContainerRecord,
  createExplorerContainerParentSyncLane,
  createRemoteExplorerContainer,
  deleteExplorerContainers,
  type ExplorerContainerMetadataPatch,
  type ExplorerMetadataSyncAttempt,
  type ExplorerPersistence,
  enqueuePendingExplorerContainerUpdate,
  initializeExplorerSchema,
  listExplorerDocumentsForContainerSubtree,
  listPendingExplorerContainerCreateIntents,
  listPendingExplorerContainerUpdates,
  loadContainerParentSyncWatermark,
  loadStoredExplorerContainers,
  markExplorerContainerCreateIntentSynced,
  persistExplorerContainerMetadataState,
  recordExplorerContainerCreateIntentError,
  saveContainerParentSyncWatermark,
  saveExplorerContainer,
  syncRemoteExplorerContainerMetadata,
} from "../../workflows/explorer";
import { primeDocumentStore } from "../documents/DocumentsProvider";
import { createExplorerDocumentsRuntime } from "./documentRuntime";

type ExplorerAppData = ReturnType<typeof useAppData>;

export type ContainerMetadataDocument = Awaited<
  ReturnType<typeof createContainerMetadataDocument>
>;
type ListedRemoteContainer = Pick<
  ContainerSummary,
  | "id"
  | "metadataAccessEpoch"
  | "metadataAccessStateHash"
  | "metadataDocumentId"
  | "metadataReferencedPrincipals"
  | "organizationId"
  | "parentId"
>;

export interface ExplorerRuntime {
  apiClient: ExplorerAppData["apiClient"];
  blobStore: BlobStore;
  cacheReferencedPrincipalPolicies: ExplorerAppData["cacheReferencedPrincipalPolicies"];
  dbStatus: ExplorerAppData["dbStatus"];
  domainScope: ExplorerAppData["domainScope"];
  encapsulationKeyPair: ExplorerAppData["encapsulationKeyPair"];
  events: ExplorerAppData["events"];
  execSql: ExecSql;
  isAuthenticated: ExplorerAppData["isAuthenticated"];
  log: ExplorerAppData["log"];
  online: ExplorerAppData["online"];
  organizationId?: ExplorerAppData["organizationId"];
  signingFingerprint?: ExplorerAppData["signingFingerprint"];
  signingKeyPair?: ExplorerAppData["signingKeyPair"];
  userId?: ExplorerAppData["userId"];
}

export interface ContainerState {
  container: ContainerRecord;
  doc: ContainerMetadataDocument;
  record: DocumentRecord;
}

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

export type ExplorerRemoteContainer = ListedRemoteContainer;

type ListedRemoteContainersResponse = NonNullable<
  Awaited<ReturnType<ExplorerRuntime["apiClient"]["listContainers"]>>
>;
type ListedRemoteContainerPageItem =
  ListedRemoteContainersResponse["items"][number];
const CONTAINER_PARENT_HYDRATION_CONCURRENCY = 4;

interface ContainerParentHydrationLane {
  parentId: string | null;
  watermark?: ListedRemoteContainersResponse["nextWatermark"];
}

type QueueContainerParentLane = (parentId: string | null) => void;

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

interface ExplorerSyncHost {
  persistContainerState: (
    containerState: ContainerState,
    patch?: Partial<ExplorerContainerMetadataPatch>,
    updateView?: boolean,
  ) => Promise<DocumentRecord>;
  updateSnapshot: () => void;
}

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
): Promise<PendingUpdateRecord[]> {
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

async function upsertRemoteContainerState(
  state: ExplorerSyncState,
  host: ExplorerSyncHost,
  remoteContainer: ExplorerRemoteContainer,
): Promise<ContainerState> {
  const existingState = state.containersById.get(remoteContainer.id);

  if (existingState) {
    await host.persistContainerState(
      existingState,
      {
        accessEpoch: remoteContainer.metadataAccessEpoch,
        accessStateHash: remoteContainer.metadataAccessStateHash,
        documentId: remoteContainer.metadataDocumentId,
        metadataDocumentId: remoteContainer.metadataDocumentId,
        organizationId: remoteContainer.organizationId,
        parentId: remoteContainer.parentId,
      },
      false,
    );
    return existingState;
  }

  const doc = await createContainerMetadataDocument(remoteContainer.id);
  const initialSnapshot = bytesToBase64(exportAllUpdates(doc));
  const containerState: ContainerState = {
    container: {
      id: remoteContainer.id,
      organizationId: remoteContainer.organizationId,
      parentId: remoteContainer.parentId,
      metadataDocumentId: remoteContainer.metadataDocumentId,
      name: getDefaultContainerName(remoteContainer.parentId),
      icon: null,
    },
    doc,
    record: {
      accessEpoch: remoteContainer.metadataAccessEpoch,
      accessStateHash: remoteContainer.metadataAccessStateHash,
      documentId: remoteContainer.metadataDocumentId,
      id: remoteContainer.id,
      lastCommitLsn: null,
      loroSnapshot: initialSnapshot,
      contentKeyBundle: null,
      documentKekTargets: null,
      documentManifestBundle: null,
    },
  };

  await saveExplorerContainer(
    state.runtime.execSql,
    state.persistence,
    containerState.container,
    containerState.record,
  );
  state.containersById.set(remoteContainer.id, containerState);
  return containerState;
}

function createContainerParentHydrationQueue(containerIds: Iterable<string>): {
  lanes: ContainerParentHydrationLane[];
  queueParentLane: QueueContainerParentLane;
} {
  const queuedParentIds = new Set<string>();
  const lanes: ContainerParentHydrationLane[] = [];
  const queueParentLane = (parentId: string | null) => {
    const laneKey = parentId === null ? "root" : `container:${parentId}`;
    if (queuedParentIds.has(laneKey)) {
      return;
    }

    queuedParentIds.add(laneKey);
    lanes.push({ parentId });
  };

  queueParentLane(null);
  for (const containerId of containerIds) {
    queueParentLane(containerId);
  }

  return { lanes, queueParentLane };
}

async function applyRemoteContainerPage(input: {
  host: ExplorerSyncHost;
  items: ReadonlyArray<ListedRemoteContainerPageItem>;
  queueParentLane: QueueContainerParentLane;
  seenContainerIds: Set<string>;
  state: ExplorerSyncState;
}): Promise<number> {
  const { host, items, queueParentLane, seenContainerIds, state } = input;
  let hydratedCount = 0;

  await state.runtime.cacheReferencedPrincipalPolicies(
    items.flatMap(
      (remoteContainer) => remoteContainer.metadataReferencedPrincipals ?? [],
    ),
  );

  for (const container of items) {
    if (!seenContainerIds.has(container.id)) {
      seenContainerIds.add(container.id);
      await upsertRemoteContainerState(state, host, container);
      hydratedCount += 1;
    }

    queueParentLane(container.id);
  }

  return hydratedCount;
}

function latestContainerItemsById(
  items: ReadonlyArray<ListedRemoteContainerPageItem>,
): Map<string, ListedRemoteContainerPageItem> {
  const latestItems = new Map<string, ListedRemoteContainerPageItem>();
  for (const item of items) {
    const current = latestItems.get(item.id);
    if (!current || current.updatedAt.localeCompare(item.updatedAt) < 0) {
      latestItems.set(item.id, item);
    }
  }

  return latestItems;
}

function latestContainerTombstonesById(
  tombstones: ReadonlyArray<ContainerSyncTombstone>,
): Map<string, ContainerSyncTombstone> {
  const latestTombstones = new Map<string, ContainerSyncTombstone>();
  for (const tombstone of tombstones) {
    const current = latestTombstones.get(tombstone.containerId);
    if (!current || current.updatedAt.localeCompare(tombstone.updatedAt) < 0) {
      latestTombstones.set(tombstone.containerId, tombstone);
    }
  }

  return latestTombstones;
}

function getApplicableContainerTombstones(
  response: ListedRemoteContainersResponse,
): ContainerSyncTombstone[] {
  const latestItems = latestContainerItemsById(response.items);
  return Array.from(
    latestContainerTombstonesById(response.tombstones).values(),
  ).filter((tombstone) => {
    const item = latestItems.get(tombstone.containerId);
    return !item || item.updatedAt.localeCompare(tombstone.updatedAt) < 0;
  });
}

function getApplicableRemoteContainerItems(
  response: ListedRemoteContainersResponse,
): ListedRemoteContainerPageItem[] {
  const latestTombstones = latestContainerTombstonesById(response.tombstones);
  return response.items.filter((item) => {
    const tombstone = latestTombstones.get(item.id);
    return !tombstone || tombstone.updatedAt.localeCompare(item.updatedAt) <= 0;
  });
}

function collectRemovedContainerIds(input: {
  containersById: ReadonlyMap<string, ContainerState>;
  preservedContainerIds: ReadonlySet<string>;
  tombstones: ReadonlyArray<ContainerSyncTombstone>;
}): string[] {
  const { containersById, preservedContainerIds, tombstones } = input;
  const childIdsByParentId = new Map<string, string[]>();
  for (const [containerId, containerState] of containersById) {
    const parentId = containerState.container.parentId;
    if (parentId === null) {
      continue;
    }

    const childIds = childIdsByParentId.get(parentId) ?? [];
    childIds.push(containerId);
    childIdsByParentId.set(parentId, childIds);
  }

  const removedContainerIds = new Set<string>();
  const pendingContainerIds = tombstones
    .map((tombstone) => tombstone.containerId)
    .filter((containerId) => !preservedContainerIds.has(containerId));

  while (pendingContainerIds.length > 0) {
    const containerId = pendingContainerIds.pop();
    if (!containerId || removedContainerIds.has(containerId)) {
      continue;
    }

    removedContainerIds.add(containerId);
    for (const childId of childIdsByParentId.get(containerId) ?? []) {
      if (
        !preservedContainerIds.has(childId) &&
        !removedContainerIds.has(childId)
      ) {
        pendingContainerIds.push(childId);
      }
    }
  }

  return Array.from(removedContainerIds).filter((containerId) =>
    containersById.has(containerId),
  );
}

function getLatestContainerTombstoneUpdatedAt(
  tombstones: ReadonlyArray<ContainerSyncTombstone>,
): string | undefined {
  return tombstones.reduce<string | undefined>(
    (latestUpdatedAt, tombstone) =>
      !latestUpdatedAt || latestUpdatedAt.localeCompare(tombstone.updatedAt) < 0
        ? tombstone.updatedAt
        : latestUpdatedAt,
    undefined,
  );
}

async function applyContainerTombstones(input: {
  preservedContainerIds: ReadonlySet<string>;
  response: ListedRemoteContainersResponse;
  state: ExplorerSyncState;
}): Promise<number> {
  const { preservedContainerIds, response, state } = input;
  const tombstones = getApplicableContainerTombstones(response);
  if (tombstones.length === 0) {
    return 0;
  }

  const removedContainerIds = collectRemovedContainerIds({
    containersById: state.containersById,
    preservedContainerIds,
    tombstones,
  });
  const tombstoneUpdatedAt = getLatestContainerTombstoneUpdatedAt(tombstones);

  await deleteExplorerContainers(
    state.runtime.execSql,
    state.persistence,
    removedContainerIds,
    tombstoneUpdatedAt ? { updatedAt: tombstoneUpdatedAt } : undefined,
  );
  for (const containerId of removedContainerIds) {
    state.containersById.delete(containerId);
  }

  return removedContainerIds.length;
}

async function advanceContainerParentWatermark(input: {
  response: ListedRemoteContainersResponse;
  state: ExplorerSyncState;
  syncLane: ReturnType<typeof createExplorerContainerParentSyncLane>;
}): Promise<boolean> {
  const { response, state, syncLane } = input;
  if (response.nextWatermark) {
    await saveContainerParentSyncWatermark(
      state.runtime.execSql,
      syncLane,
      response.nextWatermark,
    );
  }

  return true;
}

interface FetchedContainerParentLanePage {
  lane: ContainerParentHydrationLane;
  response: ListedRemoteContainersResponse;
  syncLane: ReturnType<typeof createExplorerContainerParentSyncLane>;
}

function canHydrateRemoteContainers(state: ExplorerSyncState): boolean {
  return (
    state.runtime.isAuthenticated &&
    state.runtime.online &&
    state.runtime.dbStatus === "ready"
  );
}

async function fetchContainerParentLanePage(input: {
  lane: ContainerParentHydrationLane;
  state: ExplorerSyncState;
}): Promise<FetchedContainerParentLanePage | null> {
  const { lane, state } = input;
  const syncLane = createExplorerContainerParentSyncLane(lane.parentId);
  const watermark =
    lane.watermark === undefined
      ? await loadContainerParentSyncWatermark(state.runtime.execSql, syncLane)
      : lane.watermark;
  const response = await state.runtime.apiClient.listContainers({
    parentId: lane.parentId,
    watermark,
  });

  return response ? { lane, response, syncLane } : null;
}

async function applyContainerParentLanePage(input: {
  fetchedPage: FetchedContainerParentLanePage;
  host: ExplorerSyncHost;
  queueContinuationLane: (lane: ContainerParentHydrationLane) => void;
  queueParentLane: QueueContainerParentLane;
  seenContainerIds: Set<string>;
  state: ExplorerSyncState;
}): Promise<{ changedCount: number; shouldStop: boolean }> {
  const {
    fetchedPage,
    host,
    queueContinuationLane,
    queueParentLane,
    seenContainerIds,
    state,
  } = input;
  const { lane, response, syncLane } = fetchedPage;
  let changedCount = 0;

  const remoteContainerItems = getApplicableRemoteContainerItems(response);
  changedCount += await applyContainerTombstones({
    preservedContainerIds: new Set(
      remoteContainerItems.map((container) => container.id),
    ),
    response,
    state,
  });

  changedCount += await applyRemoteContainerPage({
    host,
    items: remoteContainerItems,
    queueParentLane,
    seenContainerIds,
    state,
  });

  const didAdvanceWatermark = await advanceContainerParentWatermark({
    response,
    state,
    syncLane,
  });
  if (!didAdvanceWatermark) {
    return { changedCount, shouldStop: false };
  }

  if (!response.hasMore) {
    return { changedCount, shouldStop: false };
  }
  if (!response.nextWatermark) {
    return { changedCount, shouldStop: true };
  }

  queueContinuationLane({
    parentId: lane.parentId,
    watermark: response.nextWatermark,
  });
  return { changedCount, shouldStop: false };
}

function takeContainerParentLaneBatch(input: {
  lanes: ContainerParentHydrationLane[];
  state: ExplorerSyncState;
}): ContainerParentHydrationLane[] {
  const { lanes, state } = input;
  const batch: ContainerParentHydrationLane[] = [];

  while (
    lanes.length > 0 &&
    batch.length < CONTAINER_PARENT_HYDRATION_CONCURRENCY
  ) {
    const lane = lanes.shift();
    if (
      lane &&
      (lane.parentId === null || state.containersById.has(lane.parentId))
    ) {
      batch.push(lane);
    }
  }

  return batch;
}

function isFetchedContainerParentLanePage(
  fetchedPage: FetchedContainerParentLanePage | null,
): fetchedPage is FetchedContainerParentLanePage {
  return fetchedPage !== null;
}

async function fetchContainerParentLaneBatch(input: {
  batch: ReadonlyArray<ContainerParentHydrationLane>;
  state: ExplorerSyncState;
}): Promise<ReadonlyArray<FetchedContainerParentLanePage> | null> {
  const { batch, state } = input;
  const fetchedPages = await Promise.all(
    batch.map((lane) => fetchContainerParentLanePage({ lane, state })),
  );

  return fetchedPages.every(isFetchedContainerParentLanePage)
    ? fetchedPages
    : null;
}

function canApplyFetchedContainerParentLanePage(input: {
  fetchedPage: FetchedContainerParentLanePage;
  state: ExplorerSyncState;
}): boolean {
  const { fetchedPage, state } = input;
  return (
    fetchedPage.lane.parentId === null ||
    state.containersById.has(fetchedPage.lane.parentId)
  );
}

async function applyContainerParentLaneBatch(input: {
  fetchedPages: ReadonlyArray<FetchedContainerParentLanePage>;
  host: ExplorerSyncHost;
  lanes: ContainerParentHydrationLane[];
  queueParentLane: QueueContainerParentLane;
  seenContainerIds: Set<string>;
  state: ExplorerSyncState;
}): Promise<{ changedCount: number; shouldStop: boolean }> {
  const {
    fetchedPages,
    host,
    lanes,
    queueParentLane,
    seenContainerIds,
    state,
  } = input;
  let changedCount = 0;

  for (const fetchedPage of fetchedPages) {
    if (!canHydrateRemoteContainers(state)) {
      return { changedCount, shouldStop: true };
    }
    if (!canApplyFetchedContainerParentLanePage({ fetchedPage, state })) {
      continue;
    }

    const result = await applyContainerParentLanePage({
      fetchedPage,
      host,
      queueContinuationLane: (lane) => lanes.push(lane),
      queueParentLane,
      seenContainerIds,
      state,
    });
    changedCount += result.changedCount;

    if (result.shouldStop) {
      return { changedCount, shouldStop: true };
    }
  }

  return { changedCount, shouldStop: false };
}

async function hydrateContainerParentLanes(input: {
  host: ExplorerSyncHost;
  lanes: ContainerParentHydrationLane[];
  queueParentLane: QueueContainerParentLane;
  seenContainerIds: Set<string>;
  state: ExplorerSyncState;
}): Promise<{ changedCount: number; shouldStop: boolean }> {
  const { host, lanes, queueParentLane, seenContainerIds, state } = input;
  let changedCount = 0;

  while (lanes.length > 0) {
    if (!canHydrateRemoteContainers(state)) {
      return { changedCount, shouldStop: true };
    }

    const batch = takeContainerParentLaneBatch({ lanes, state });
    if (batch.length === 0) {
      continue;
    }

    const fetchedPages = await fetchContainerParentLaneBatch({ batch, state });
    if (!fetchedPages) {
      return { changedCount, shouldStop: true };
    }

    const result = await applyContainerParentLaneBatch({
      fetchedPages,
      host,
      lanes,
      queueParentLane,
      seenContainerIds,
      state,
    });
    changedCount += result.changedCount;

    if (result.shouldStop) {
      return { changedCount, shouldStop: true };
    }
  }

  return { changedCount, shouldStop: false };
}

async function hydrateRemoteContainers(
  state: ExplorerSyncState,
  host: ExplorerSyncHost,
): Promise<void> {
  if (!canHydrateRemoteContainers(state)) {
    return;
  }

  const seenContainerIds = new Set<string>();
  const { lanes, queueParentLane } = createContainerParentHydrationQueue(
    state.containersById.keys(),
  );
  const { changedCount } = await hydrateContainerParentLanes({
    host,
    lanes,
    queueParentLane,
    seenContainerIds,
    state,
  });

  if (changedCount > 0) {
    host.updateSnapshot();
    state.runtime.log(
      `Explorer: applied ${changedCount} remote container change(s)`,
    );
  }
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

  state.remoteHydrationPromise = hydrateRemoteContainers(state, host)
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
  const storedContainers = await loadStoredExplorerContainers(
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
    await hydrateRemoteContainers(state, host);
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
            await upsertRemoteContainerState(
              state,
              host,
              queuedRemoteContainer,
            );
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

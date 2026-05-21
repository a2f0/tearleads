import { bytesToBase64 } from "@tearleads/encoding";
import { exportAllUpdates } from "@tearleads/loro";
import type {
  ContainerSummary,
  ContainerSyncTombstone,
  ListContainersResponse,
  ReferencedPrincipalStateResponse,
  SyncWatermark,
} from "@tearleads/validators/response";
import {
  createContainerMetadataDocument,
  getDefaultContainerName,
} from "../../data/containers/containerMetadataDocument";
import {
  type ContainerRecord,
  createExplorerContainerParentSyncLane,
  deleteExplorerContainers,
  type ExplorerDocumentRecord,
  type ExplorerPersistence,
  type LocalRootDescendantReparentInput,
  loadContainerParentSyncWatermark,
  reconcileExplorerLocalRootContainer,
  saveContainerParentSyncWatermark,
  saveExplorerContainer,
} from "./containerPersistence";
import type { ExplorerContainerMetadataPatch } from "./metadata";
import {
  type ExplorerWorkflowSqlRuntime,
  getExplorerWorkflowRuntimeExecSql,
} from "./runtime";

type ListedRemoteContainerPageItem = ListContainersResponse["items"][number];
type ContainerChildIndex = Map<string, Set<string>>;
type QueueContainerParentLane = (parentId: string | null) => void;
type RemoteContainerIngestQueue = Map<string, ExplorerRemoteContainer>;

const CONTAINER_PARENT_HYDRATION_CONCURRENCY = 4;

export type ExplorerContainerMetadataDocument = Awaited<
  ReturnType<typeof createContainerMetadataDocument>
>;
export type ExplorerRemoteContainer = Pick<
  ContainerSummary,
  | "createdAt"
  | "id"
  | "metadataAccessEpoch"
  | "metadataAccessStateHash"
  | "metadataDocumentId"
  | "metadataReferencedPrincipals"
  | "organizationId"
  | "parentId"
  | "updatedAt"
>;

export interface ExplorerContainerState {
  container: ContainerRecord;
  doc: ExplorerContainerMetadataDocument;
  record: ExplorerDocumentRecord;
}

interface ExplorerRemoteContainerHydrationApi {
  listContainers(options?: {
    limit?: number;
    parentId?: string | null;
    watermark?: SyncWatermark | null;
  }): Promise<ListContainersResponse | null>;
}

interface ExplorerRemoteContainerHydrationRuntime
  extends ExplorerWorkflowSqlRuntime {
  apiClient: ExplorerRemoteContainerHydrationApi;
  cacheReferencedPrincipalPolicies: (
    references: ReadonlyArray<ReferencedPrincipalStateResponse> | undefined,
  ) => Promise<void>;
  dbStatus: string;
  isAuthenticated: boolean;
  log: (message: string) => void;
  online: boolean;
  organizationId?: string | null | undefined;
}

interface ExplorerRemoteContainerHydrationState {
  containersById: Map<string, ExplorerContainerState>;
  persistence: ExplorerPersistence;
  runtime: ExplorerRemoteContainerHydrationRuntime;
}

export interface ExplorerRemoteContainerHydrationHost {
  persistContainerState: (
    containerState: ExplorerContainerState,
    patch?: Partial<ExplorerContainerMetadataPatch>,
    updateView?: boolean,
  ) => Promise<ExplorerDocumentRecord>;
  updateSnapshot: () => void;
}

interface ContainerParentHydrationLane {
  parentId: string | null;
  watermark?: ListContainersResponse["nextWatermark"];
}

interface FetchedContainerParentLanePage {
  lane: ContainerParentHydrationLane;
  response: ListContainersResponse;
  syncLane: ReturnType<typeof createExplorerContainerParentSyncLane>;
}

function applyRemoteContainerTimestamps(
  container: ContainerRecord,
  remoteContainer: ExplorerRemoteContainer,
): ContainerRecord {
  return {
    ...container,
    createdAt: remoteContainer.createdAt,
    serverCreatedAt: remoteContainer.createdAt,
    serverUpdatedAt: remoteContainer.updatedAt,
    updatedAt: remoteContainer.updatedAt,
  };
}

function addIndexedContainerChild(
  childIdsByParentId: ContainerChildIndex,
  containerId: string,
  parentId: string | null,
) {
  if (parentId === null) {
    return;
  }

  const childIds = childIdsByParentId.get(parentId) ?? new Set<string>();
  childIds.add(containerId);
  childIdsByParentId.set(parentId, childIds);
}

function removeIndexedContainerChild(
  childIdsByParentId: ContainerChildIndex,
  containerId: string,
  parentId: string | null,
) {
  if (parentId === null) {
    return;
  }

  const childIds = childIdsByParentId.get(parentId);
  if (!childIds) {
    return;
  }

  childIds.delete(containerId);
  if (childIds.size === 0) {
    childIdsByParentId.delete(parentId);
  }
}

function moveIndexedContainerChild(
  childIdsByParentId: ContainerChildIndex | undefined,
  containerId: string,
  previousParentId: string | null,
  nextParentId: string | null,
) {
  if (!childIdsByParentId || previousParentId === nextParentId) {
    return;
  }

  removeIndexedContainerChild(
    childIdsByParentId,
    containerId,
    previousParentId,
  );
  addIndexedContainerChild(childIdsByParentId, containerId, nextParentId);
}

function createContainerChildIndex(
  containersById: ReadonlyMap<string, ExplorerContainerState>,
): ContainerChildIndex {
  const childIdsByParentId: ContainerChildIndex = new Map();

  for (const [containerId, containerState] of containersById) {
    addIndexedContainerChild(
      childIdsByParentId,
      containerId,
      containerState.container.parentId,
    );
  }

  return childIdsByParentId;
}

function hasRemoteExplorerContainerMetadataState(
  containerState: ExplorerContainerState,
): boolean {
  return (
    typeof containerState.record.documentId === "string" &&
    containerState.record.documentId.length > 0 &&
    typeof containerState.record.accessStateHash === "string" &&
    containerState.record.accessStateHash.length > 0 &&
    typeof containerState.container.metadataDocumentId === "string" &&
    containerState.container.metadataDocumentId.length > 0
  );
}

function isLocalOnlyRootContainerState(
  containerState: ExplorerContainerState,
): boolean {
  return (
    containerState.container.parentId === null &&
    !hasRemoteExplorerContainerMetadataState(containerState)
  );
}

function canUseRemoteRootAsLocalRootReconciliationTarget(input: {
  remoteRootState: ExplorerContainerState;
  state: ExplorerRemoteContainerHydrationState;
}): boolean {
  const { remoteRootState, state } = input;
  return (
    remoteRootState.container.parentId === null &&
    (!state.runtime.organizationId ||
      remoteRootState.container.organizationId === state.runtime.organizationId)
  );
}

function collectContainerSubtreeStates(input: {
  childIdsByParentId?: ContainerChildIndex | undefined;
  containersById: ReadonlyMap<string, ExplorerContainerState>;
  rootContainerId: string;
}): ExplorerContainerState[] {
  const { childIdsByParentId, containersById, rootContainerId } = input;
  const subtreeStates: ExplorerContainerState[] = [];
  const pendingContainerIds = [rootContainerId];
  const visitedContainerIds = new Set<string>();
  const index = childIdsByParentId ?? createContainerChildIndex(containersById);

  while (pendingContainerIds.length > 0) {
    const containerId = pendingContainerIds.pop();
    if (!containerId || visitedContainerIds.has(containerId)) {
      continue;
    }
    visitedContainerIds.add(containerId);

    const childIds = index.get(containerId);
    if (!childIds) {
      continue;
    }

    for (const childId of childIds) {
      const childState = containersById.get(childId);
      if (!childState) {
        continue;
      }

      subtreeStates.push(childState);
      pendingContainerIds.push(childId);
    }
  }

  return subtreeStates;
}

function buildLocalRootDescendantReparents(input: {
  childIdsByParentId?: ContainerChildIndex | undefined;
  localRootState: ExplorerContainerState;
  remoteRootState: ExplorerContainerState;
  state: ExplorerRemoteContainerHydrationState;
}): {
  descendantReparents: LocalRootDescendantReparentInput[];
  descendants: ExplorerContainerState[];
} {
  const { childIdsByParentId, localRootState, remoteRootState, state } = input;
  const descendants = collectContainerSubtreeStates({
    childIdsByParentId,
    containersById: state.containersById,
    rootContainerId: localRootState.container.id,
  });
  const descendantReparents = descendants.map((descendant) => {
    const previousParentId = descendant.container.parentId;
    const parentContainerId =
      previousParentId === localRootState.container.id
        ? remoteRootState.container.id
        : previousParentId;

    return {
      containerId: descendant.container.id,
      parentContainerId,
      updateCreateIntent: !descendant.record.documentId && !!parentContainerId,
    };
  });

  return { descendantReparents, descendants };
}

function applyLocalRootDescendantReparents(input: {
  childIdsByParentId?: ContainerChildIndex | undefined;
  descendantReparents: ReadonlyArray<LocalRootDescendantReparentInput>;
  descendants: ReadonlyArray<ExplorerContainerState>;
  remoteRootState: ExplorerContainerState;
  updatedAt: string;
}): void {
  const {
    childIdsByParentId,
    descendantReparents,
    descendants,
    remoteRootState,
    updatedAt,
  } = input;
  const reparentByContainerId = new Map(
    descendantReparents.map((reparent) => [reparent.containerId, reparent]),
  );

  for (const descendant of descendants) {
    const previousParentId = descendant.container.parentId;
    const reparent = reparentByContainerId.get(descendant.container.id);
    if (!reparent) {
      continue;
    }

    descendant.container = {
      ...descendant.container,
      organizationId: remoteRootState.container.organizationId,
      parentId: reparent.parentContainerId,
      localUpdatedAt: updatedAt,
      updatedAt: descendant.container.serverUpdatedAt ?? updatedAt,
    };
    moveIndexedContainerChild(
      childIdsByParentId,
      descendant.container.id,
      previousParentId,
      reparent.parentContainerId,
    );
  }
}

async function reconcileLocalOnlyRootContainer(input: {
  childIdsByParentId?: ContainerChildIndex | undefined;
  localRootState: ExplorerContainerState;
  remoteRootState: ExplorerContainerState;
  state: ExplorerRemoteContainerHydrationState;
}): Promise<void> {
  const { childIdsByParentId, localRootState, remoteRootState, state } = input;
  const execSql = getExplorerWorkflowRuntimeExecSql(state.runtime);
  const updatedAt = new Date().toISOString();
  const { descendantReparents, descendants } =
    buildLocalRootDescendantReparents({
      childIdsByParentId,
      localRootState,
      remoteRootState,
      state,
    });

  await reconcileExplorerLocalRootContainer(execSql, state.persistence, {
    descendantReparents,
    localRootContainerId: localRootState.container.id,
    remoteOrganizationId: remoteRootState.container.organizationId,
    remoteRootContainerId: remoteRootState.container.id,
    updatedAt,
  });
  applyLocalRootDescendantReparents({
    childIdsByParentId,
    descendantReparents,
    descendants,
    remoteRootState,
    updatedAt,
  });

  if (childIdsByParentId) {
    removeIndexedContainerChild(
      childIdsByParentId,
      localRootState.container.id,
      localRootState.container.parentId,
    );
    childIdsByParentId.delete(localRootState.container.id);
  }
  state.containersById.delete(localRootState.container.id);
  state.runtime.log(
    `Explorer: reconciled local root ${localRootState.container.id} into remote root ${remoteRootState.container.id}`,
  );
}

async function reconcileLocalOnlyRootContainers(input: {
  childIdsByParentId?: ContainerChildIndex | undefined;
  remoteRootState: ExplorerContainerState;
  state: ExplorerRemoteContainerHydrationState;
}): Promise<number> {
  const { childIdsByParentId, remoteRootState, state } = input;
  if (
    !canUseRemoteRootAsLocalRootReconciliationTarget({
      remoteRootState,
      state,
    })
  ) {
    return 0;
  }

  const localRootStates = Array.from(state.containersById.values()).filter(
    (containerState) =>
      containerState.container.id !== remoteRootState.container.id &&
      isLocalOnlyRootContainerState(containerState),
  );

  for (const localRootState of localRootStates) {
    await reconcileLocalOnlyRootContainer({
      childIdsByParentId,
      localRootState,
      remoteRootState,
      state,
    });
  }

  return localRootStates.length;
}

async function updateExistingRemoteExplorerContainerState(input: {
  childIdsByParentId?: ContainerChildIndex | undefined;
  host: ExplorerRemoteContainerHydrationHost;
  existingState: ExplorerContainerState;
  remoteContainer: ExplorerRemoteContainer;
  state: ExplorerRemoteContainerHydrationState;
}): Promise<ExplorerContainerState> {
  const { childIdsByParentId, existingState, host, remoteContainer, state } =
    input;
  const previousParentId = existingState.container.parentId;
  existingState.container = applyRemoteContainerTimestamps(
    existingState.container,
    remoteContainer,
  );
  existingState.record = await host.persistContainerState(
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
  existingState.container = {
    ...existingState.container,
    metadataDocumentId: remoteContainer.metadataDocumentId,
    organizationId: remoteContainer.organizationId,
    parentId: remoteContainer.parentId,
  };
  moveIndexedContainerChild(
    childIdsByParentId,
    remoteContainer.id,
    previousParentId,
    existingState.container.parentId,
  );
  await reconcileLocalOnlyRootContainers({
    childIdsByParentId,
    remoteRootState: existingState,
    state,
  });
  return existingState;
}

async function insertRemoteExplorerContainerState(input: {
  childIdsByParentId?: ContainerChildIndex | undefined;
  remoteContainer: ExplorerRemoteContainer;
  state: ExplorerRemoteContainerHydrationState;
}): Promise<ExplorerContainerState> {
  const { childIdsByParentId, remoteContainer, state } = input;
  const doc = await createContainerMetadataDocument(remoteContainer.id);
  const initialSnapshot = bytesToBase64(exportAllUpdates(doc));
  const execSql = getExplorerWorkflowRuntimeExecSql(state.runtime);
  const containerState: ExplorerContainerState = {
    container: applyRemoteContainerTimestamps(
      {
        id: remoteContainer.id,
        organizationId: remoteContainer.organizationId,
        parentId: remoteContainer.parentId,
        metadataDocumentId: remoteContainer.metadataDocumentId,
        name: getDefaultContainerName(remoteContainer.parentId),
        icon: null,
      },
      remoteContainer,
    ),
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

  containerState.container = await saveExplorerContainer(
    execSql,
    state.persistence,
    containerState.container,
    containerState.record,
    {
      serverTimestamps: {
        createdAt: remoteContainer.createdAt,
        updatedAt: remoteContainer.updatedAt,
      },
    },
  );
  state.containersById.set(remoteContainer.id, containerState);
  if (childIdsByParentId) {
    addIndexedContainerChild(
      childIdsByParentId,
      remoteContainer.id,
      remoteContainer.parentId,
    );
  }
  await reconcileLocalOnlyRootContainers({
    childIdsByParentId,
    remoteRootState: containerState,
    state,
  });
  return containerState;
}

async function upsertRemoteExplorerContainerState(input: {
  childIdsByParentId?: ContainerChildIndex | undefined;
  host: ExplorerRemoteContainerHydrationHost;
  remoteContainer: ExplorerRemoteContainer;
  state: ExplorerRemoteContainerHydrationState;
}): Promise<ExplorerContainerState> {
  const existingState = input.state.containersById.get(
    input.remoteContainer.id,
  );
  return existingState
    ? updateExistingRemoteExplorerContainerState({
        childIdsByParentId: input.childIdsByParentId,
        existingState,
        host: input.host,
        remoteContainer: input.remoteContainer,
        state: input.state,
      })
    : insertRemoteExplorerContainerState({
        childIdsByParentId: input.childIdsByParentId,
        remoteContainer: input.remoteContainer,
        state: input.state,
      });
}

function isCurrentQueuedRemoteContainer(
  queue: RemoteContainerIngestQueue,
  remoteContainer: ExplorerRemoteContainer,
): boolean {
  return queue.get(remoteContainer.id) === remoteContainer;
}

async function cacheQueuedRemoteContainerPrincipals(input: {
  queuedRemoteContainers: ReadonlyArray<ExplorerRemoteContainer>;
  state: ExplorerRemoteContainerHydrationState;
}) {
  const { queuedRemoteContainers, state } = input;
  await state.runtime.cacheReferencedPrincipalPolicies(
    queuedRemoteContainers.flatMap(
      (queuedRemoteContainer) =>
        queuedRemoteContainer.metadataReferencedPrincipals ?? [],
    ),
  );
}

async function upsertQueuedRemoteContainer(input: {
  host: ExplorerRemoteContainerHydrationHost;
  queue: RemoteContainerIngestQueue;
  queuedRemoteContainer: ExplorerRemoteContainer;
  state: ExplorerRemoteContainerHydrationState;
}): Promise<boolean> {
  const { host, queue, queuedRemoteContainer, state } = input;
  if (!isCurrentQueuedRemoteContainer(queue, queuedRemoteContainer)) {
    return false;
  }

  await upsertRemoteExplorerContainerState({
    host,
    remoteContainer: queuedRemoteContainer,
    state,
  });
  if (isCurrentQueuedRemoteContainer(queue, queuedRemoteContainer)) {
    queue.delete(queuedRemoteContainer.id);
  }
  return true;
}

async function drainRemoteExplorerContainerIngestQueue(input: {
  host: ExplorerRemoteContainerHydrationHost;
  queue: RemoteContainerIngestQueue;
  state: ExplorerRemoteContainerHydrationState;
}) {
  const { host, queue, state } = input;
  let shouldUpdateSnapshot = false;

  try {
    while (queue.size > 0) {
      const queuedRemoteContainers = Array.from(queue.values());
      await cacheQueuedRemoteContainerPrincipals({
        queuedRemoteContainers,
        state,
      });

      for (const queuedRemoteContainer of queuedRemoteContainers) {
        shouldUpdateSnapshot =
          (await upsertQueuedRemoteContainer({
            host,
            queue,
            queuedRemoteContainer,
            state,
          })) || shouldUpdateSnapshot;
      }

      if (shouldUpdateSnapshot) {
        host.updateSnapshot();
        shouldUpdateSnapshot = false;
      }
    }
  } catch (error) {
    if (shouldUpdateSnapshot) {
      host.updateSnapshot();
    }
    throw error;
  }
}

export function createRemoteExplorerContainerIngestor(input: {
  host: ExplorerRemoteContainerHydrationHost;
  state: ExplorerRemoteContainerHydrationState;
}): (remoteContainer: ExplorerRemoteContainer) => Promise<void> {
  const { host, state } = input;
  const pendingRemoteContainersById: RemoteContainerIngestQueue = new Map();
  let ingestRemoteContainersPromise: Promise<void> | null = null;

  return async (remoteContainer: ExplorerRemoteContainer) => {
    pendingRemoteContainersById.set(remoteContainer.id, remoteContainer);

    if (ingestRemoteContainersPromise) {
      return ingestRemoteContainersPromise;
    }

    ingestRemoteContainersPromise = (async () => {
      await Promise.resolve();

      try {
        await drainRemoteExplorerContainerIngestQueue({
          host,
          queue: pendingRemoteContainersById,
          state,
        });
      } finally {
        ingestRemoteContainersPromise = null;
      }
    })();

    return ingestRemoteContainersPromise;
  };
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
  childIdsByParentId: ContainerChildIndex;
  host: ExplorerRemoteContainerHydrationHost;
  items: ReadonlyArray<ListedRemoteContainerPageItem>;
  queueParentLane: QueueContainerParentLane;
  seenContainerIds: Set<string>;
  state: ExplorerRemoteContainerHydrationState;
}): Promise<number> {
  const {
    childIdsByParentId,
    host,
    items,
    queueParentLane,
    seenContainerIds,
    state,
  } = input;
  let hydratedCount = 0;

  await state.runtime.cacheReferencedPrincipalPolicies(
    items.flatMap(
      (remoteContainer) => remoteContainer.metadataReferencedPrincipals ?? [],
    ),
  );

  for (const container of items) {
    if (!seenContainerIds.has(container.id)) {
      seenContainerIds.add(container.id);
      await upsertRemoteExplorerContainerState({
        childIdsByParentId,
        host,
        remoteContainer: container,
        state,
      });
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
    if (!current || current.updatedAt < item.updatedAt) {
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
    if (!current || current.updatedAt < tombstone.updatedAt) {
      latestTombstones.set(tombstone.containerId, tombstone);
    }
  }

  return latestTombstones;
}

function getApplicableContainerTombstones(
  response: ListContainersResponse,
): ContainerSyncTombstone[] {
  const latestItems = latestContainerItemsById(response.items);
  return Array.from(
    latestContainerTombstonesById(response.tombstones).values(),
  ).filter((tombstone) => {
    const item = latestItems.get(tombstone.containerId);
    return !item || item.updatedAt < tombstone.updatedAt;
  });
}

function getApplicableRemoteContainerItems(
  response: ListContainersResponse,
): ListedRemoteContainerPageItem[] {
  const latestTombstones = latestContainerTombstonesById(response.tombstones);
  return response.items.filter((item) => {
    const tombstone = latestTombstones.get(item.id);
    return !tombstone || tombstone.updatedAt <= item.updatedAt;
  });
}

function collectRemovedContainerIds(input: {
  childIdsByParentId: ContainerChildIndex;
  containersById: ReadonlyMap<string, ExplorerContainerState>;
  preservedContainerIds: ReadonlySet<string>;
  tombstones: ReadonlyArray<ContainerSyncTombstone>;
}): string[] {
  const {
    childIdsByParentId,
    containersById,
    preservedContainerIds,
    tombstones,
  } = input;
  const removedContainerIds = new Set<string>();
  const pendingContainerIds: string[] = [];

  for (const tombstone of tombstones) {
    if (!preservedContainerIds.has(tombstone.containerId)) {
      pendingContainerIds.push(tombstone.containerId);
    }
  }

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
      !latestUpdatedAt || latestUpdatedAt < tombstone.updatedAt
        ? tombstone.updatedAt
        : latestUpdatedAt,
    undefined,
  );
}

async function applyContainerTombstones(input: {
  childIdsByParentId: ContainerChildIndex;
  preservedContainerIds: ReadonlySet<string>;
  response: ListContainersResponse;
  state: ExplorerRemoteContainerHydrationState;
}): Promise<number> {
  const { childIdsByParentId, preservedContainerIds, response, state } = input;
  const tombstones = getApplicableContainerTombstones(response);
  if (tombstones.length === 0) {
    return 0;
  }

  const removedContainerIds = collectRemovedContainerIds({
    childIdsByParentId,
    containersById: state.containersById,
    preservedContainerIds,
    tombstones,
  });
  const tombstoneUpdatedAt = getLatestContainerTombstoneUpdatedAt(tombstones);
  const execSql = getExplorerWorkflowRuntimeExecSql(state.runtime);

  await deleteExplorerContainers(
    execSql,
    state.persistence,
    removedContainerIds,
    tombstoneUpdatedAt ? { updatedAt: tombstoneUpdatedAt } : undefined,
  );
  for (const containerId of removedContainerIds) {
    const parentId =
      state.containersById.get(containerId)?.container.parentId ?? null;
    removeIndexedContainerChild(childIdsByParentId, containerId, parentId);
    childIdsByParentId.delete(containerId);
    state.containersById.delete(containerId);
  }

  return removedContainerIds.length;
}

async function advanceContainerParentWatermark(input: {
  response: ListContainersResponse;
  state: ExplorerRemoteContainerHydrationState;
  syncLane: ReturnType<typeof createExplorerContainerParentSyncLane>;
}): Promise<boolean> {
  const { response, state, syncLane } = input;
  if (response.nextWatermark) {
    const execSql = getExplorerWorkflowRuntimeExecSql(state.runtime);
    await saveContainerParentSyncWatermark(
      execSql,
      syncLane,
      response.nextWatermark,
    );
  }

  return true;
}

function canHydrateRemoteContainers(
  state: ExplorerRemoteContainerHydrationState,
): boolean {
  return (
    state.runtime.isAuthenticated &&
    state.runtime.online &&
    state.runtime.dbStatus === "ready"
  );
}

async function fetchContainerParentLanePage(input: {
  lane: ContainerParentHydrationLane;
  state: ExplorerRemoteContainerHydrationState;
}): Promise<FetchedContainerParentLanePage | null> {
  const { lane, state } = input;
  const syncLane = createExplorerContainerParentSyncLane(lane.parentId);
  const execSql = getExplorerWorkflowRuntimeExecSql(state.runtime);
  const watermark =
    lane.watermark === undefined
      ? await loadContainerParentSyncWatermark(execSql, syncLane)
      : lane.watermark;
  const response = await state.runtime.apiClient.listContainers({
    parentId: lane.parentId,
    watermark,
  });

  return response ? { lane, response, syncLane } : null;
}

async function applyContainerParentLanePage(input: {
  childIdsByParentId: ContainerChildIndex;
  fetchedPage: FetchedContainerParentLanePage;
  host: ExplorerRemoteContainerHydrationHost;
  queueContinuationLane: (lane: ContainerParentHydrationLane) => void;
  queueParentLane: QueueContainerParentLane;
  seenContainerIds: Set<string>;
  state: ExplorerRemoteContainerHydrationState;
}): Promise<{ changedCount: number; shouldStop: boolean }> {
  const {
    childIdsByParentId,
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
    childIdsByParentId,
    preservedContainerIds: new Set(
      remoteContainerItems.map((container) => container.id),
    ),
    response,
    state,
  });

  changedCount += await applyRemoteContainerPage({
    childIdsByParentId,
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
  state: ExplorerRemoteContainerHydrationState;
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
  state: ExplorerRemoteContainerHydrationState;
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
  state: ExplorerRemoteContainerHydrationState;
}): boolean {
  const { fetchedPage, state } = input;
  return (
    fetchedPage.lane.parentId === null ||
    state.containersById.has(fetchedPage.lane.parentId)
  );
}

async function applyContainerParentLaneBatch(input: {
  childIdsByParentId: ContainerChildIndex;
  fetchedPages: ReadonlyArray<FetchedContainerParentLanePage>;
  host: ExplorerRemoteContainerHydrationHost;
  lanes: ContainerParentHydrationLane[];
  queueParentLane: QueueContainerParentLane;
  seenContainerIds: Set<string>;
  state: ExplorerRemoteContainerHydrationState;
}): Promise<{ changedCount: number; shouldStop: boolean }> {
  const {
    childIdsByParentId,
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
      childIdsByParentId,
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
  childIdsByParentId: ContainerChildIndex;
  host: ExplorerRemoteContainerHydrationHost;
  lanes: ContainerParentHydrationLane[];
  queueParentLane: QueueContainerParentLane;
  seenContainerIds: Set<string>;
  state: ExplorerRemoteContainerHydrationState;
}): Promise<{ changedCount: number; shouldStop: boolean }> {
  const {
    childIdsByParentId,
    host,
    lanes,
    queueParentLane,
    seenContainerIds,
    state,
  } = input;
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
      childIdsByParentId,
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

export async function hydrateRemoteExplorerContainers(input: {
  host: ExplorerRemoteContainerHydrationHost;
  state: ExplorerRemoteContainerHydrationState;
}): Promise<void> {
  const { host, state } = input;
  if (!canHydrateRemoteContainers(state)) {
    return;
  }

  const seenContainerIds = new Set<string>();
  const childIdsByParentId = createContainerChildIndex(state.containersById);
  const { lanes, queueParentLane } = createContainerParentHydrationQueue(
    state.containersById.keys(),
  );
  const { changedCount } = await hydrateContainerParentLanes({
    childIdsByParentId,
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

import type {
  ContainerSyncTombstone,
  ListContainersResponse,
} from "@tearleads/validators/response";
import {
  createContainerMetadataDocument,
  getDefaultContainerName,
} from "../../data/containers/containerMetadataDocument";
import { createRuntimePrincipalPolicyWarmer } from "../principals/runtimePolicyWarmer";
import type { ContainerRecord } from "./containerPersistence";
import {
  addIndexedContainerChild,
  createContainerChildIndex,
  moveIndexedContainerChild,
  removeIndexedContainerChild,
} from "./remoteHydration/childIndex";
import { markContainerParentLaneFetched } from "./remoteHydration/laneFetchMarkers";
import { fetchContainerParentLaneBatch } from "./remoteHydration/parentLaneFetch";
import { createContainerParentHydrationQueue } from "./remoteHydration/parentLaneQueue";
import { cacheRemoteContainerPrincipalPolicies } from "./remoteHydration/principalPolicyCache";
import { reattachDormantContainerMetadata } from "./remoteHydration/reattachMetadata";
import {
  reconcileLocalOnlyRootContainers,
  reconcileLocalOnlySystemContainers,
} from "./remoteHydration/reconciliation";
import {
  collectRemovedContainers,
  selectRetainedMetadataContainerIds,
} from "./remoteHydration/tombstoneReasons";
import type {
  ContainerChildIndex,
  ContainerParentHydrationLane,
  ContainerState,
  FetchedContainerParentLanePage,
  ListedRemoteContainerPageItem,
  QueueContainerParentLane,
  RemoteContainer,
  RemoteContainerHydrationHost,
  RemoteContainerHydrationState,
  RemoteContainerIngestQueue,
  SaveContainerOptions,
} from "./remoteHydration/types";
import { describeRemoteContainerHydration } from "./remoteHydrationLog";

export type {
  ContainerState,
  RemoteContainer,
  RemoteContainerHydrationHost,
} from "./remoteHydration/types";

const CONTAINER_PARENT_HYDRATION_CONCURRENCY = 4;

function applyRemoteContainerTimestamps(
  container: ContainerRecord,
  remoteContainer: RemoteContainer,
): ContainerRecord {
  return {
    ...container,
    createdAt: remoteContainer.createdAt,
    effectiveAccessLevel: remoteContainer.effectiveAccessLevel,
    serverCreatedAt: remoteContainer.createdAt,
    serverUpdatedAt: remoteContainer.updatedAt,
    updatedAt: remoteContainer.updatedAt,
  };
}

function remoteContainerHydrationSaveOptions(input: {
  localUpdatedAt?: string | null | undefined;
  remoteContainer: RemoteContainer;
}): SaveContainerOptions {
  return {
    localUpdatedAt: input.localUpdatedAt ?? input.remoteContainer.updatedAt,
    serverTimestamps: {
      createdAt: input.remoteContainer.createdAt,
      updatedAt: input.remoteContainer.updatedAt,
    },
  };
}

function resolveRemoteContainerHydrationLocalUpdatedAt(input: {
  containerIdsWithPendingMetadataUpdates: ReadonlySet<string>;
  hasPendingStructuralIntent: boolean;
  previousLocalUpdatedAt: string | null | undefined;
  remoteContainer: RemoteContainer;
}): string {
  const {
    containerIdsWithPendingMetadataUpdates,
    hasPendingStructuralIntent,
    previousLocalUpdatedAt,
    remoteContainer,
  } = input;
  if (
    !previousLocalUpdatedAt ||
    previousLocalUpdatedAt.localeCompare(remoteContainer.updatedAt) <= 0
  ) {
    return remoteContainer.updatedAt;
  }

  return containerIdsWithPendingMetadataUpdates.has(remoteContainer.id) ||
    hasPendingStructuralIntent
    ? previousLocalUpdatedAt
    : remoteContainer.updatedAt;
}

// Container ids (restricted to the inbound page) that carry an unsynced local
// create or move intent. Such a container's parent and local-edit timestamp are
// owned by its structural-intent lane until that lane reconciles, so inbound
// hydration must not revert parentId to the server value nor collapse
// localUpdatedAt — doing so silently undoes a queued move and falsely reads
// "synced". Move intents are read via listUnsyncedMoveIntents (not the
// 'pending'-only list) so a blocked move — one whose destination parent has not
// synced yet, the common boot-time case — is protected too. Pending *metadata*
// updates are handled separately (listRemoteContainerIdsWithPendingMetadataUpdates);
// these live in dedicated create/move intent tables that that query does not cover.
async function listRemoteContainerIdsWithPendingStructuralIntents(input: {
  remoteContainers: ReadonlyArray<RemoteContainer>;
  state: RemoteContainerHydrationState;
}): Promise<Set<string>> {
  if (input.remoteContainers.length === 0) {
    return new Set();
  }
  const remoteContainerIds = new Set(
    input.remoteContainers.map((remoteContainer) => remoteContainer.id),
  );

  const execSql = input.state.runtime.infra.execSql;
  const [pendingCreateIntents, unsyncedMoveIntents] = await Promise.all([
    input.state.persistence.listPendingCreateIntents(execSql),
    input.state.persistence.listUnsyncedMoveIntents(execSql),
  ]);
  const containerIdsWithPendingStructuralIntents = new Set<string>();
  for (const intent of pendingCreateIntents) {
    if (remoteContainerIds.has(intent.containerId)) {
      containerIdsWithPendingStructuralIntents.add(intent.containerId);
    }
  }
  for (const intent of unsyncedMoveIntents) {
    if (remoteContainerIds.has(intent.containerId)) {
      containerIdsWithPendingStructuralIntents.add(intent.containerId);
    }
  }
  return containerIdsWithPendingStructuralIntents;
}

async function listRemoteContainerIdsWithPendingMetadataUpdates(input: {
  remoteContainers: ReadonlyArray<RemoteContainer>;
  state: RemoteContainerHydrationState;
}): Promise<Set<string>> {
  const containerIds = input.remoteContainers.flatMap((remoteContainer) => {
    const previousLocalUpdatedAt = input.state.containersById.get(
      remoteContainer.id,
    )?.container.localUpdatedAt;

    return previousLocalUpdatedAt &&
      previousLocalUpdatedAt.localeCompare(remoteContainer.updatedAt) > 0
      ? [remoteContainer.id]
      : [];
  });
  if (containerIds.length === 0) {
    return new Set();
  }

  const execSql = input.state.runtime.infra.execSql;
  return new Set(
    await input.state.persistence.listContainerIdsWithPendingUpdates(
      execSql,
      containerIds,
    ),
  );
}

async function updateExistingRemoteContainerState(input: {
  childIdsByParentId?: ContainerChildIndex | undefined;
  containerIdsWithPendingMetadataUpdates: ReadonlySet<string>;
  containerIdsWithPendingStructuralIntents: ReadonlySet<string>;
  host: RemoteContainerHydrationHost;
  existingState: ContainerState;
  remoteContainer: RemoteContainer;
  state: RemoteContainerHydrationState;
}): Promise<ContainerState> {
  const { childIdsByParentId, existingState, host, remoteContainer, state } =
    input;
  const previousParentId = existingState.container.parentId;
  const previousLocalUpdatedAt = existingState.container.localUpdatedAt;
  // A queued, not-yet-synced local move/create owns this container's parent
  // until its intent lane reconciles. Keep the local parent (and local-edit
  // timestamp) instead of the inbound server values, so hydration cannot revert
  // a pending move or report it as synced before the move actually syncs.
  const hasPendingStructuralIntent =
    input.containerIdsWithPendingStructuralIntents.has(remoteContainer.id);
  const nextParentId = hasPendingStructuralIntent
    ? previousParentId
    : remoteContainer.parentId;
  const localUpdatedAt = resolveRemoteContainerHydrationLocalUpdatedAt({
    containerIdsWithPendingMetadataUpdates:
      input.containerIdsWithPendingMetadataUpdates,
    hasPendingStructuralIntent,
    previousLocalUpdatedAt,
    remoteContainer,
  });
  existingState.container = applyRemoteContainerTimestamps(
    existingState.container,
    remoteContainer,
  );
  existingState.containerWriterProjection = null;
  existingState.metadataReferencedPrincipals =
    remoteContainer.metadataReferencedPrincipals;
  existingState.record = await host.persistContainerState(
    existingState,
    {
      accessEpoch: remoteContainer.metadataAccessEpoch,
      accessStateHash: remoteContainer.metadataAccessStateHash,
      documentId: remoteContainer.metadataDocumentId,
      metadataDocumentId: remoteContainer.metadataDocumentId,
      systemSlot: remoteContainer.systemSlot ?? null,
      organizationId: remoteContainer.organizationId,
      parentId: nextParentId,
    },
    false,
    remoteContainerHydrationSaveOptions({
      localUpdatedAt,
      remoteContainer,
    }),
  );
  existingState.container = {
    ...existingState.container,
    metadataDocumentId: remoteContainer.metadataDocumentId,
    organizationId: remoteContainer.organizationId,
    parentId: nextParentId,
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
    requestDocumentPriming: host.requestDocumentPriming,
    state,
  });
  return existingState;
}

async function insertRemoteContainerState(input: {
  childIdsByParentId?: ContainerChildIndex | undefined;
  host: RemoteContainerHydrationHost;
  remoteContainer: RemoteContainer;
  state: RemoteContainerHydrationState;
}): Promise<ContainerState> {
  const { childIdsByParentId, host, remoteContainer, state } = input;
  const doc = await createContainerMetadataDocument(remoteContainer.id);
  const execSql = state.runtime.infra.execSql;
  // A container inserted with dormant retained metadata (row 4's
  // access_revoked branch) is a re-attach, not a fresh discovery: import the
  // retained content and markers instead of overwriting them with an empty
  // document. Access and keying fields still come from the remote container —
  // revocation may have rotated them.
  const dormantRecord = await state.persistence.loadContainerMetadataRecord(
    execSql,
    remoteContainer.id,
  );
  const reattached = reattachDormantContainerMetadata({
    defaultName: getDefaultContainerName(remoteContainer.parentId),
    doc,
    dormantRecord,
    remoteMetadataDocumentId: remoteContainer.metadataDocumentId,
  });
  const initialSnapshot = reattached.initialSnapshot;
  const containerState: ContainerState = {
    container: applyRemoteContainerTimestamps(
      {
        id: remoteContainer.id,
        effectiveAccessLevel: remoteContainer.effectiveAccessLevel,
        organizationId: remoteContainer.organizationId,
        parentId: remoteContainer.parentId,
        metadataDocumentId: remoteContainer.metadataDocumentId,
        systemSlot: remoteContainer.systemSlot ?? null,
        name: reattached.name,
        icon: reattached.icon,
      },
      remoteContainer,
    ),
    metadataReferencedPrincipals: remoteContainer.metadataReferencedPrincipals,
    doc,
    record: {
      accessEpoch: remoteContainer.metadataAccessEpoch,
      accessStateHash: remoteContainer.metadataAccessStateHash,
      documentId: remoteContainer.metadataDocumentId,
      id: remoteContainer.id,
      lastCommitLsn: reattached.lastCommitLsn,
      metadataUpdates: initialSnapshot,
      snapshotEndVersion: reattached.snapshotEndVersion,
      contentKeyBundle: null,
      documentKekTargets: null,
      documentManifestBundle: null,
    },
  };

  containerState.container = await state.persistence.saveContainer(
    execSql,
    containerState.container,
    containerState.record,
    remoteContainerHydrationSaveOptions({ remoteContainer }),
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
    requestDocumentPriming: host.requestDocumentPriming,
    state,
  });
  return containerState;
}

async function upsertRemoteContainerState(input: {
  childIdsByParentId?: ContainerChildIndex | undefined;
  containerIdsWithPendingMetadataUpdates: ReadonlySet<string>;
  containerIdsWithPendingStructuralIntents: ReadonlySet<string>;
  host: RemoteContainerHydrationHost;
  remoteContainer: RemoteContainer;
  state: RemoteContainerHydrationState;
}): Promise<ContainerState> {
  const existingState = input.state.containersById.get(
    input.remoteContainer.id,
  );
  const remoteState = existingState
    ? await updateExistingRemoteContainerState({
        childIdsByParentId: input.childIdsByParentId,
        containerIdsWithPendingMetadataUpdates:
          input.containerIdsWithPendingMetadataUpdates,
        containerIdsWithPendingStructuralIntents:
          input.containerIdsWithPendingStructuralIntents,
        existingState,
        host: input.host,
        remoteContainer: input.remoteContainer,
        state: input.state,
      })
    : await insertRemoteContainerState({
        childIdsByParentId: input.childIdsByParentId,
        host: input.host,
        remoteContainer: input.remoteContainer,
        state: input.state,
      });
  await reconcileLocalOnlySystemContainers({
    childIdsByParentId: input.childIdsByParentId,
    requestDocumentPriming: input.host.requestDocumentPriming,
    remoteSystemState: remoteState,
    state: input.state,
  });
  return remoteState;
}

function isCurrentQueuedRemoteContainer(
  queue: RemoteContainerIngestQueue,
  remoteContainer: RemoteContainer,
): boolean {
  return queue.get(remoteContainer.id) === remoteContainer;
}

async function upsertQueuedRemoteContainer(input: {
  containerIdsWithPendingMetadataUpdates: ReadonlySet<string>;
  containerIdsWithPendingStructuralIntents: ReadonlySet<string>;
  host: RemoteContainerHydrationHost;
  queue: RemoteContainerIngestQueue;
  queuedRemoteContainer: RemoteContainer;
  state: RemoteContainerHydrationState;
}): Promise<boolean> {
  const {
    containerIdsWithPendingMetadataUpdates,
    containerIdsWithPendingStructuralIntents,
    host,
    queue,
    queuedRemoteContainer,
    state,
  } = input;
  if (!isCurrentQueuedRemoteContainer(queue, queuedRemoteContainer)) {
    return false;
  }

  await upsertRemoteContainerState({
    containerIdsWithPendingMetadataUpdates,
    containerIdsWithPendingStructuralIntents,
    host,
    remoteContainer: queuedRemoteContainer,
    state,
  });
  if (isCurrentQueuedRemoteContainer(queue, queuedRemoteContainer)) {
    queue.delete(queuedRemoteContainer.id);
  }
  return true;
}

async function drainRemoteContainerIngestQueue(input: {
  host: RemoteContainerHydrationHost;
  queue: RemoteContainerIngestQueue;
  state: RemoteContainerHydrationState;
}) {
  const { host, queue, state } = input;
  let shouldUpdateSnapshot = false;

  try {
    while (queue.size > 0) {
      const queuedRemoteContainers = Array.from(queue.values());
      await cacheRemoteContainerPrincipalPolicies({
        cacheReferencedPrincipalPolicies: createRuntimePrincipalPolicyWarmer(
          state.runtime,
        ),
        remoteContainers: queuedRemoteContainers,
      });
      const [
        containerIdsWithPendingMetadataUpdates,
        containerIdsWithPendingStructuralIntents,
      ] = await Promise.all([
        listRemoteContainerIdsWithPendingMetadataUpdates({
          remoteContainers: queuedRemoteContainers,
          state,
        }),
        listRemoteContainerIdsWithPendingStructuralIntents({
          remoteContainers: queuedRemoteContainers,
          state,
        }),
      ]);

      for (const queuedRemoteContainer of queuedRemoteContainers) {
        shouldUpdateSnapshot =
          (await upsertQueuedRemoteContainer({
            containerIdsWithPendingMetadataUpdates,
            containerIdsWithPendingStructuralIntents,
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

export function createRemoteContainerIngestor(input: {
  host: RemoteContainerHydrationHost;
  state: RemoteContainerHydrationState;
}): (remoteContainer: RemoteContainer) => Promise<void> {
  const { host, state } = input;
  const pendingRemoteContainersById: RemoteContainerIngestQueue = new Map();
  let ingestRemoteContainersPromise: Promise<void> | null = null;

  return async (remoteContainer: RemoteContainer) => {
    pendingRemoteContainersById.set(remoteContainer.id, remoteContainer);

    if (ingestRemoteContainersPromise) {
      return ingestRemoteContainersPromise;
    }

    ingestRemoteContainersPromise = (async () => {
      await Promise.resolve();

      try {
        await drainRemoteContainerIngestQueue({
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

async function applyRemoteContainerPage(input: {
  childIdsByParentId: ContainerChildIndex;
  host: RemoteContainerHydrationHost;
  items: ReadonlyArray<ListedRemoteContainerPageItem>;
  queueParentLane: QueueContainerParentLane;
  seenContainerIds: Set<string>;
  state: RemoteContainerHydrationState;
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

  await cacheRemoteContainerPrincipalPolicies({
    cacheReferencedPrincipalPolicies: createRuntimePrincipalPolicyWarmer(
      state.runtime,
    ),
    remoteContainers: items,
  });
  const [
    containerIdsWithPendingMetadataUpdates,
    containerIdsWithPendingStructuralIntents,
  ] = await Promise.all([
    listRemoteContainerIdsWithPendingMetadataUpdates({
      remoteContainers: items,
      state,
    }),
    listRemoteContainerIdsWithPendingStructuralIntents({
      remoteContainers: items,
      state,
    }),
  ]);

  for (const container of items) {
    if (!seenContainerIds.has(container.id)) {
      seenContainerIds.add(container.id);
      await upsertRemoteContainerState({
        childIdsByParentId,
        containerIdsWithPendingMetadataUpdates,
        containerIdsWithPendingStructuralIntents,
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
  state: RemoteContainerHydrationState;
}): Promise<number> {
  const { childIdsByParentId, preservedContainerIds, response, state } = input;
  const tombstones = getApplicableContainerTombstones(response);
  if (tombstones.length === 0) {
    return 0;
  }

  const {
    purgeMetadataContainerIds,
    reasonByContainerId,
    removedContainerIds,
  } = collectRemovedContainers({
    childIdsByParentId,
    containersById: state.containersById,
    preservedContainerIds,
    tombstones,
  });
  const tombstoneUpdatedAt = getLatestContainerTombstoneUpdatedAt(tombstones);
  const execSql = state.runtime.infra.execSql;

  // Row 4 policy (docs/sync-edge-cases.md): a revoked container's own
  // metadata document — queued edits included — is retained dormant, because
  // the container still exists server-side and re-attaches by id when access
  // restoration rehydrates it. A deleted container's metadata is moot.
  // purgeMetadataContainerIds have no local container state (a revoke already
  // cascaded them) but a later deleted tombstone must still purge their
  // dormant retained metadata; every delete in the cascade is id-scoped, so
  // including them is a no-op beyond that purge.
  await state.persistence.deleteContainers(
    execSql,
    [...removedContainerIds, ...purgeMetadataContainerIds],
    {
      retainMetadataForContainerIds: selectRetainedMetadataContainerIds({
        containersById: state.containersById,
        reasonByContainerId,
        removedContainerIds,
      }),
      ...(tombstoneUpdatedAt ? { updatedAt: tombstoneUpdatedAt } : {}),
    },
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

function canHydrateRemoteContainers(
  state: RemoteContainerHydrationState,
): boolean {
  return (
    state.runtime.auth.isAuthenticated &&
    state.runtime.state.online &&
    state.runtime.infra.dbStatus === "ready"
  );
}

async function applyContainerParentLanePage(input: {
  childIdsByParentId: ContainerChildIndex;
  fetchedPage: FetchedContainerParentLanePage;
  host: RemoteContainerHydrationHost;
  queueContinuationLane: (lane: ContainerParentHydrationLane) => void;
  queueParentLane: QueueContainerParentLane;
  seenContainerIds: Set<string>;
  state: RemoteContainerHydrationState;
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

  const didMarkFetched = await markContainerParentLaneFetched({
    response,
    state,
    syncLane,
  });
  if (!didMarkFetched) {
    return { changedCount, shouldStop: true };
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
  state: RemoteContainerHydrationState;
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

function canApplyFetchedContainerParentLanePage(input: {
  fetchedPage: FetchedContainerParentLanePage;
  state: RemoteContainerHydrationState;
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
  host: RemoteContainerHydrationHost;
  lanes: ContainerParentHydrationLane[];
  queueParentLane: QueueContainerParentLane;
  seenContainerIds: Set<string>;
  state: RemoteContainerHydrationState;
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
  host: RemoteContainerHydrationHost;
  lanes: ContainerParentHydrationLane[];
  queueParentLane: QueueContainerParentLane;
  seenContainerIds: Set<string>;
  state: RemoteContainerHydrationState;
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

export async function hydrateRemoteContainers(input: {
  followDiscoveredParentLanes?: boolean | undefined;
  host: RemoteContainerHydrationHost;
  parentIds?: ReadonlyArray<string | null> | undefined;
  resetRootLaneWatermark?: boolean | undefined;
  state: RemoteContainerHydrationState;
}): Promise<number> {
  const { host, state } = input;
  if (!canHydrateRemoteContainers(state)) {
    return 0;
  }

  const seenContainerIds = new Set<string>();
  const containerIdsBeforeHydration = new Set(state.containersById.keys());
  const childIdsByParentId = createContainerChildIndex(state.containersById);
  const { lanes, queueParentLane } = createContainerParentHydrationQueue({
    containerIds: state.containersById.keys(),
    parentIds: input.parentIds,
    resetRootLaneWatermark: input.resetRootLaneWatermark,
  });
  // Follow a discovered container's child lane when EITHER the caller opted into a
  // full recursive crawl (explicit refresh sets followDiscoveredParentLanes), OR
  // the container is one we had never hydrated before this pass. The second clause
  // is what lets a newly-authorized root auto-populate its children: when a group
  // grant surfaces the owner's root on the null lane, that root is absent from
  // containerIdsBeforeHydration, so its child lane is queued and the recursion
  // continues into each freshly discovered descendant (Contacts, Trash, ...) within
  // the same pass. Without it, automatic paths (startup, shared_with_you event,
  // event-tick) discover the root but never list its remote children, so they only
  // appear after a manual View -> Refresh. Already-known containers are still NOT
  // re-crawled on a routine tick — that stays gated behind followDiscoveredParentLanes
  // — so steady-state hydration remains shallow and cache-first.
  const queueDiscoveredParentLane: QueueContainerParentLane = (containerId) => {
    if (
      input.followDiscoveredParentLanes ||
      (containerId !== null && !containerIdsBeforeHydration.has(containerId))
    ) {
      queueParentLane(containerId);
    }
  };
  const { changedCount } = await hydrateContainerParentLanes({
    childIdsByParentId,
    host,
    lanes,
    queueParentLane: queueDiscoveredParentLane,
    seenContainerIds,
    state,
  });

  if (changedCount > 0) {
    host.updateSnapshot();
    let insertedCount = 0;
    for (const containerId of seenContainerIds) {
      if (!containerIdsBeforeHydration.has(containerId)) {
        insertedCount++;
      }
    }
    state.runtime.util.log(
      describeRemoteContainerHydration({ changedCount, insertedCount }),
    );
  }
  return changedCount;
}

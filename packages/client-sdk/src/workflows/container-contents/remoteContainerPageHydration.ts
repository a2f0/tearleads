import type {
  ContainerSyncTombstone,
  ListContainersResponse,
} from "@symcrypt/validators/response";
import { createRuntimePrincipalPolicyWarmer } from "../principals/runtimePolicyWarmer";
import {
  listRemoteContainerIdsWithPendingMetadataUpdates,
  listRemoteContainerIdsWithPendingStructuralIntents,
  upsertRemoteContainerState,
} from "./remoteContainerState";
import { removeIndexedContainerChild } from "./remoteHydration/childIndex";
import { markContainerParentLaneFetched } from "./remoteHydration/laneFetchMarkers";
import { fetchContainerParentLaneBatch } from "./remoteHydration/parentLaneFetch";
import { cacheRemoteContainerPrincipalPolicies } from "./remoteHydration/principalPolicyCache";
import {
  collectRemovedContainers,
  selectRetainedMetadataContainerIds,
} from "./remoteHydration/tombstoneReasons";
import type {
  ContainerChildIndex,
  ContainerParentHydrationLane,
  FetchedContainerParentLanePage,
  ListedRemoteContainerPageItem,
  QueueContainerParentLane,
  RemoteContainerHydrationHost,
  RemoteContainerHydrationState,
} from "./remoteHydration/types";

const CONTAINER_PARENT_HYDRATION_CONCURRENCY = 4;

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
    ownTombstoneContainerIds,
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
        ownTombstoneContainerIds,
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

export function canHydrateRemoteContainers(
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
  const removedContainerCount = await applyContainerTombstones({
    childIdsByParentId,
    preservedContainerIds: new Set(
      remoteContainerItems.map((container) => container.id),
    ),
    response,
    state,
  });
  changedCount += removedContainerCount;
  if (removedContainerCount > 0) {
    // A live tombstone cascade may have orphaned documents (row 3); re-arm
    // document priming so their null-scoped passes run now rather than on
    // the next startup.
    host.requestDocumentPriming?.();
  }

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

export async function hydrateContainerParentLanes(input: {
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

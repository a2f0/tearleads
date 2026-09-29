import { createRuntimePrincipalPolicyWarmer } from "../principals/runtimePolicyWarmer";
import {
  listRemoteContainerIdsWithPendingMetadataUpdates,
  listRemoteContainerIdsWithPendingStructuralIntents,
  upsertIsolatedRemoteContainerState,
} from "./remoteContainerState";
import { containerStateMatchesFingerprint } from "./remoteHydration/containerStateFingerprint";
import { prefetchDestinationProjections } from "./remoteHydration/destinationPrefetch";
import { cachedDestinationRole } from "./remoteHydration/destinationRoleCache";
import { markContainerParentLaneFetched } from "./remoteHydration/laneFetchMarkers";
import { fetchContainerParentLaneBatch } from "./remoteHydration/parentLaneFetch";
import { cacheRemoteContainerPrincipalPolicies } from "./remoteHydration/principalPolicyCache";
import {
  applyContainerTombstones,
  getApplicableRemoteContainerItems,
} from "./remoteHydration/tombstoneApplication";
import type {
  ContainerChildIndex,
  ContainerParentHydrationLane,
  ExpectedContainerState,
  FetchedContainerParentLanePage,
  ListedRemoteContainerPageItem,
  QueueContainerParentLane,
  RemoteContainerHydrationHost,
  RemoteContainerHydrationState,
} from "./remoteHydration/types";

const CONTAINER_PARENT_HYDRATION_CONCURRENCY = 4;

interface HydrationProgress {
  changedCount: number;
  complete: boolean;
  shouldStop: boolean;
}
async function applyRemoteContainerPage(input: {
  childIdsByParentId: ContainerChildIndex;
  expectedContainerStates: ReadonlyMap<string, ExpectedContainerState>;
  expectedHydrationTombstones: FetchedContainerParentLanePage["expectedHydrationTombstones"];
  host: RemoteContainerHydrationHost;
  isCurrent?: (() => boolean) | undefined;
  items: ReadonlyArray<ListedRemoteContainerPageItem>;
  queueParentLane: QueueContainerParentLane;
  seenContainerIds: Set<string>;
  state: RemoteContainerHydrationState;
}): Promise<{ changedCount: number; completed: boolean }> {
  const {
    childIdsByParentId,
    expectedContainerStates,
    expectedHydrationTombstones,
    host,
    items,
    queueParentLane,
    seenContainerIds,
    state,
  } = input;
  let hydratedCount = 0;
  let pageCompleted = true;
  await cacheRemoteContainerPrincipalPolicies({
    cacheReferencedPrincipalPolicies: createRuntimePrincipalPolicyWarmer(
      state.runtime,
    ),
    remoteContainers: items,
    stillCurrent: input.isCurrent,
  });
  if (input.isCurrent?.() === false) {
    return { changedCount: 0, completed: false };
  }
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
  if (input.isCurrent?.() === false) {
    return { changedCount: 0, completed: false };
  }
  const prefetchedProjections = await prefetchDestinationProjections({
    containerIds: items.flatMap((item) =>
      seenContainerIds.has(item.id) ||
      state.containersById.has(item.id) ||
      expectedHydrationTombstones.get(item.id) ||
      cachedDestinationRole(state.runtime.infra.execSql, item)
        ? []
        : [item.id],
    ),
    isCurrent: input.isCurrent,
    runtime: state.runtime,
  });
  for (const container of items) {
    if (input.isCurrent?.() === false) {
      return { changedCount: hydratedCount, completed: false };
    }
    if (!seenContainerIds.has(container.id)) {
      if (
        !containerStateMatchesFingerprint({
          currentState: state.containersById.get(container.id),
          expectedFingerprint: expectedContainerStates.get(container.id)
            ?.fingerprint,
        })
      ) {
        pageCompleted = false;
        continue;
      }
      const upserted = await upsertIsolatedRemoteContainerState({
        childIdsByParentId,
        containerIdsWithPendingMetadataUpdates,
        containerIdsWithPendingStructuralIntents,
        host,
        isCurrent: input.isCurrent,
        expectedHydrationTombstone:
          expectedHydrationTombstones.get(container.id) ?? null,
        prefetchedProjection: prefetchedProjections.get(container.id),
        remoteContainer: container,
        state,
      });
      if (!upserted) {
        pageCompleted = false;
        continue;
      }
      seenContainerIds.add(container.id);
      hydratedCount += 1;
      if (input.isCurrent?.() === false) {
        return { changedCount: hydratedCount, completed: false };
      }
    }
    queueParentLane(container.id);
  }

  return { changedCount: hydratedCount, completed: pageCompleted };
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
  isCurrent?: (() => boolean) | undefined;
  queueContinuationLane: (lane: ContainerParentHydrationLane) => void;
  queueParentLane: QueueContainerParentLane;
  seenContainerIds: Set<string>;
  state: RemoteContainerHydrationState;
}): Promise<HydrationProgress> {
  const {
    childIdsByParentId,
    fetchedPage,
    host,
    queueContinuationLane,
    queueParentLane,
    seenContainerIds,
    state,
  } = input;
  const {
    expectedContainerStates,
    expectedHydrationTombstones,
    lane,
    response,
    syncLane,
  } = fetchedPage;
  let changedCount = 0;
  if (input.isCurrent?.() === false) {
    return { changedCount, complete: false, shouldStop: true };
  }

  const remoteContainerItems = getApplicableRemoteContainerItems(response);
  const tombstoneResult = await applyContainerTombstones({
    childIdsByParentId,
    expectedContainerStates,
    isCurrent: input.isCurrent,
    remoteContainerItems,
    response,
    state,
  });
  if (!tombstoneResult.current) {
    return { changedCount, complete: false, shouldStop: true };
  }
  changedCount += tombstoneResult.changedCount;
  if (input.isCurrent?.() === false) {
    return { changedCount, complete: false, shouldStop: true };
  }
  if (tombstoneResult.changedCount > 0) {
    // A live tombstone cascade may have orphaned documents (row 3); re-arm
    // document priming so their null-scoped passes run now rather than on
    // the next startup.
    host.requestDocumentPriming?.();
  }

  const appliedPage = await applyRemoteContainerPage({
    childIdsByParentId,
    expectedContainerStates,
    expectedHydrationTombstones,
    host,
    isCurrent: input.isCurrent,
    items: remoteContainerItems,
    queueParentLane,
    seenContainerIds,
    state,
  });
  changedCount += appliedPage.changedCount;
  if (!tombstoneResult.completed || !appliedPage.completed) {
    // Keep this page retryable without discarding independent lanes, including
    // children of roots first discovered here. Otherwise the root becomes known
    // but its children are never fetched by subsequent root-only refreshes.
    return { changedCount, complete: false, shouldStop: false };
  }
  if (input.isCurrent?.() === false) {
    return { changedCount, complete: false, shouldStop: true };
  }

  const didMarkFetched = await markContainerParentLaneFetched({
    isCurrent: input.isCurrent,
    response,
    state,
    syncLane,
  });
  if (!didMarkFetched) {
    return { changedCount, complete: false, shouldStop: true };
  }

  if (!response.hasMore) {
    return { changedCount, complete: true, shouldStop: false };
  }
  if (!response.nextWatermark) {
    return { changedCount, complete: false, shouldStop: true };
  }

  queueContinuationLane({
    parentId: lane.parentId,
    watermark: response.nextWatermark,
  });
  return { changedCount, complete: true, shouldStop: false };
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

async function applyContainerParentLaneBatch(input: {
  childIdsByParentId: ContainerChildIndex;
  fetchedPages: ReadonlyArray<FetchedContainerParentLanePage>;
  host: RemoteContainerHydrationHost;
  isCurrent?: (() => boolean) | undefined;
  lanes: ContainerParentHydrationLane[];
  queueParentLane: QueueContainerParentLane;
  seenContainerIds: Set<string>;
  state: RemoteContainerHydrationState;
}): Promise<HydrationProgress> {
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
  let complete = true;

  for (const fetchedPage of fetchedPages) {
    if (!canHydrateRemoteContainers(state) || input.isCurrent?.() === false) {
      return { changedCount, complete: false, shouldStop: true };
    }
    if (
      fetchedPage.lane.parentId !== null &&
      !state.containersById.has(fetchedPage.lane.parentId)
    ) {
      continue;
    }

    const result = await applyContainerParentLanePage({
      childIdsByParentId,
      fetchedPage,
      host,
      isCurrent: input.isCurrent,
      queueContinuationLane: (lane) => lanes.push(lane),
      queueParentLane,
      seenContainerIds,
      state,
    });
    changedCount += result.changedCount;
    complete &&= result.complete;

    if (result.shouldStop) {
      return { changedCount, complete: false, shouldStop: true };
    }
  }

  return { changedCount, complete, shouldStop: false };
}

export async function hydrateContainerParentLanes(input: {
  childIdsByParentId: ContainerChildIndex;
  host: RemoteContainerHydrationHost;
  isCurrent?: (() => boolean) | undefined;
  lanes: ContainerParentHydrationLane[];
  queueParentLane: QueueContainerParentLane;
  seenContainerIds: Set<string>;
  state: RemoteContainerHydrationState;
}): Promise<HydrationProgress> {
  const {
    childIdsByParentId,
    host,
    lanes,
    queueParentLane,
    seenContainerIds,
    state,
  } = input;
  let changedCount = 0;
  let complete = true;

  while (lanes.length > 0) {
    if (!canHydrateRemoteContainers(state) || input.isCurrent?.() === false) {
      return { changedCount, complete: false, shouldStop: true };
    }

    const batch = takeContainerParentLaneBatch({ lanes, state });
    if (batch.length === 0) {
      continue;
    }

    const fetchedPages = await fetchContainerParentLaneBatch({
      batch,
      isCurrent: input.isCurrent,
      state,
    });
    if (!fetchedPages) {
      return { changedCount, complete: false, shouldStop: true };
    }
    if (input.isCurrent?.() === false) {
      return { changedCount, complete: false, shouldStop: true };
    }

    const result = await applyContainerParentLaneBatch({
      childIdsByParentId,
      fetchedPages,
      host,
      isCurrent: input.isCurrent,
      lanes,
      queueParentLane,
      seenContainerIds,
      state,
    });
    changedCount += result.changedCount;
    complete &&= result.complete;

    if (result.shouldStop) {
      return { changedCount, complete: false, shouldStop: true };
    }
  }

  return { changedCount, complete, shouldStop: false };
}

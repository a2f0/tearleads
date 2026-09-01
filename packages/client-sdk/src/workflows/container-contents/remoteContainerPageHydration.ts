import { createRuntimePrincipalPolicyWarmer } from "../principals/runtimePolicyWarmer";
import {
  listRemoteContainerIdsWithPendingMetadataUpdates,
  listRemoteContainerIdsWithPendingStructuralIntents,
  upsertRemoteContainerState,
} from "./remoteContainerState";
import { containerStateMatchesFingerprint } from "./remoteHydration/containerStateFingerprint";
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
      const upserted = await upsertRemoteContainerState({
        childIdsByParentId,
        containerIdsWithPendingMetadataUpdates,
        containerIdsWithPendingStructuralIntents,
        host,
        isCurrent: input.isCurrent,
        expectedHydrationTombstone:
          expectedHydrationTombstones.get(container.id) ?? null,
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
  const {
    expectedContainerStates,
    expectedHydrationTombstones,
    lane,
    response,
    syncLane,
  } = fetchedPage;
  let changedCount = 0;
  if (input.isCurrent?.() === false) {
    return { changedCount, shouldStop: true };
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
    return { changedCount, shouldStop: true };
  }
  changedCount += tombstoneResult.changedCount;
  if (input.isCurrent?.() === false) {
    return { changedCount, shouldStop: true };
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
    return { changedCount, shouldStop: true };
  }
  if (input.isCurrent?.() === false) {
    return { changedCount, shouldStop: true };
  }

  const didMarkFetched = await markContainerParentLaneFetched({
    isCurrent: input.isCurrent,
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

async function applyContainerParentLaneBatch(input: {
  childIdsByParentId: ContainerChildIndex;
  fetchedPages: ReadonlyArray<FetchedContainerParentLanePage>;
  host: RemoteContainerHydrationHost;
  isCurrent?: (() => boolean) | undefined;
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
    if (!canHydrateRemoteContainers(state) || input.isCurrent?.() === false) {
      return { changedCount, shouldStop: true };
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

    if (result.shouldStop) {
      return { changedCount, shouldStop: true };
    }
  }

  return { changedCount, shouldStop: false };
}

export async function hydrateContainerParentLanes(input: {
  childIdsByParentId: ContainerChildIndex;
  host: RemoteContainerHydrationHost;
  isCurrent?: (() => boolean) | undefined;
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
    if (!canHydrateRemoteContainers(state) || input.isCurrent?.() === false) {
      return { changedCount, shouldStop: true };
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
      return { changedCount, shouldStop: true };
    }
    if (input.isCurrent?.() === false) {
      return { changedCount, shouldStop: true };
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

    if (result.shouldStop) {
      return { changedCount, shouldStop: true };
    }
  }

  return { changedCount, shouldStop: false };
}

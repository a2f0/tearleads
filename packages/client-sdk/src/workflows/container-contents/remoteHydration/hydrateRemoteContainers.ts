import { createContainerChildIndex } from "./lanes/childIndex";
import { createContainerParentHydrationQueue } from "./lanes/parentLaneQueue";
import {
  canHydrateRemoteContainers,
  hydrateContainerParentLanes,
} from "./remoteContainers/remoteContainerPageHydration";
import { describeRemoteContainerHydration } from "./remoteHydrationLog";
import type {
  QueueContainerParentLane,
  ReconnectCrawl,
  RemoteContainerHydrationHost,
  RemoteContainerHydrationState,
} from "./types";

async function finishRemoteHydration(input: {
  changedCount: number;
  complete: boolean;
  host: RemoteContainerHydrationHost;
  isCurrent?: (() => boolean) | undefined;
  onFullyHydrated?: (() => Promise<void> | void) | undefined;
  seenContainerObservations: ReadonlyMap<string, string>;
  containerIdsBeforeHydration: ReadonlySet<string>;
  state: RemoteContainerHydrationState;
}): Promise<void> {
  if (input.isCurrent?.() === false) {
    return;
  }
  if (input.changedCount > 0) {
    input.host.updateSnapshot();
    let insertedCount = 0;
    for (const containerId of input.seenContainerObservations.keys()) {
      if (!input.containerIdsBeforeHydration.has(containerId)) {
        insertedCount++;
      }
    }
    input.state.runtime.util.log(
      describeRemoteContainerHydration({
        changedCount: input.changedCount,
        insertedCount,
      }),
    );
  }
  if (
    input.complete &&
    input.isCurrent?.() !== false &&
    input.onFullyHydrated
  ) {
    await input.onFullyHydrated();
  }
}

// Distinct correlation IDs prevent an acknowledged crawl joining an older in-flight HTTP listing.
let reconnectSequence = 0;

export async function hydrateRemoteContainers(input: {
  followDiscoveredParentLanes?: boolean | undefined;
  host: RemoteContainerHydrationHost;
  isCurrent?: (() => boolean) | undefined;
  reconnect?: ReconnectCrawl | undefined;
  onFullyHydrated?: (() => Promise<void> | void) | undefined;
  parentIds?: ReadonlyArray<string | null> | undefined;
  resetAllLaneWatermarks?: boolean | undefined;
  resetRootLaneWatermark?: boolean | undefined;
  state: RemoteContainerHydrationState;
}): Promise<number> {
  const { host, state } = input;
  if (!canHydrateRemoteContainers(state) || input.isCurrent?.() === false) {
    return 0;
  }

  const seenContainerObservations = new Map<string, string>();
  const containerIdsBeforeHydration = new Set(state.containersById.keys());
  const childIdsByParentId = createContainerChildIndex(state.containersById);
  const { lanes, queueParentLane } = createContainerParentHydrationQueue({
    containerIds: state.containersById.keys(),
    parentIds: input.parentIds,
    resetAllLaneWatermarks: input.resetAllLaneWatermarks,
    resetRootLaneWatermark: input.resetRootLaneWatermark,
  });
  // Follow child lanes during an explicit recursive crawl or for containers first
  // discovered in this pass. The latter lets a newly authorized root populate its
  // descendants immediately, while routine ticks keep known subtrees cache-first.
  const queueDiscoveredParentLane: QueueContainerParentLane = (containerId) => {
    if (
      input.followDiscoveredParentLanes ||
      (containerId !== null && !containerIdsBeforeHydration.has(containerId))
    ) {
      queueParentLane(containerId);
    }
  };
  let manualError: Error | undefined;
  const result = await hydrateContainerParentLanes({
    reconnect: input.reconnect && {
      laneIdPrefix: `r${++reconnectSequence}`,
      recordManualError: (error) => {
        manualError ??= error;
      },
    },
    childIdsByParentId,
    host,
    isCurrent: input.isCurrent,
    lanes,
    queueParentLane: queueDiscoveredParentLane,
    seenContainerObservations,
    state,
  });
  const { changedCount } = result;
  await finishRemoteHydration({
    changedCount,
    complete:
      result.outcome === "complete" &&
      canHydrateRemoteContainers(state) &&
      input.isCurrent?.() !== false,
    containerIdsBeforeHydration,
    host,
    isCurrent: input.isCurrent,
    onFullyHydrated: input.onFullyHydrated,
    seenContainerObservations,
    state,
  });
  if (input.reconnect?.isCurrent() && canHydrateRemoteContainers(state)) {
    const manualRejection = input.resetAllLaneWatermarks
      ? manualError
      : undefined;
    input.reconnect.record(result.outcome, manualRejection);
    // A manual refresh sharing this crawl observes the error it would receive on its own.
    if (manualRejection) throw manualRejection;
  }
  return changedCount;
}

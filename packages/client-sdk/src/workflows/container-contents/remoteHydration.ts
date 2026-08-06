import { createRuntimePrincipalPolicyWarmer } from "../principals/runtimePolicyWarmer";
import {
  canHydrateRemoteContainers,
  hydrateContainerParentLanes,
} from "./remoteContainerPageHydration";
import {
  listRemoteContainerIdsWithPendingMetadataUpdates,
  listRemoteContainerIdsWithPendingStructuralIntents,
  upsertRemoteContainerState,
} from "./remoteContainerState";
import { createContainerChildIndex } from "./remoteHydration/childIndex";
import { finishRemoteHydration } from "./remoteHydration/completeHydration";
import { createContainerParentHydrationQueue } from "./remoteHydration/parentLaneQueue";
import { cacheRemoteContainerPrincipalPolicies } from "./remoteHydration/principalPolicyCache";
import type {
  QueueContainerParentLane,
  RemoteContainer,
  RemoteContainerHydrationHost,
  RemoteContainerHydrationState,
  RemoteContainerIngestQueue,
} from "./remoteHydration/types";

export type {
  ContainerState,
  RemoteContainer,
  RemoteContainerHydrationHost,
} from "./remoteHydration/types";

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

export async function hydrateRemoteContainers(input: {
  followDiscoveredParentLanes?: boolean | undefined;
  host: RemoteContainerHydrationHost;
  onFullyHydrated?: (() => Promise<void> | void) | undefined;
  parentIds?: ReadonlyArray<string | null> | undefined;
  resetAllLaneWatermarks?: boolean | undefined;
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
  const result = await hydrateContainerParentLanes({
    childIdsByParentId,
    host,
    lanes,
    queueParentLane: queueDiscoveredParentLane,
    seenContainerIds,
    state,
  });
  const { changedCount } = result;
  await finishRemoteHydration({
    changedCount,
    complete: !result.shouldStop && canHydrateRemoteContainers(state),
    containerIdsBeforeHydration,
    host,
    onFullyHydrated: input.onFullyHydrated,
    seenContainerIds,
    state,
  });
  return changedCount;
}

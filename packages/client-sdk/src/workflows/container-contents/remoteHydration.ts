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
  PersistContainerStateResult,
  RemoteContainer,
  RemoteContainerHydrationHost,
} from "./remoteHydration/types";

export class StaleRemoteHydrationError extends Error {}

export function createGenerationGuardedHydrationHost(input: {
  host: RemoteContainerHydrationHost;
  isCurrent: () => boolean;
}): RemoteContainerHydrationHost {
  const assertCurrent = () => {
    if (!input.isCurrent()) {
      throw new StaleRemoteHydrationError();
    }
  };

  return {
    persistContainerState: async (
      containerState,
      patch,
      updateView,
      saveOptions,
      mutationOptions,
    ) => {
      const callerIsCurrent = mutationOptions?.isCurrent;
      const isCurrent = callerIsCurrent
        ? () => input.isCurrent() && callerIsCurrent()
        : input.isCurrent;
      assertCurrent();
      const record = await input.host.persistContainerState(
        containerState,
        patch,
        updateView,
        saveOptions,
        { ...mutationOptions, isCurrent },
      );
      assertCurrent();
      return record;
    },
    ...(input.host.requestDocumentPriming
      ? {
          requestDocumentPriming: () => {
            if (input.isCurrent()) {
              input.host.requestDocumentPriming?.();
            }
          },
        }
      : {}),
    updateSnapshot: () => {
      if (input.isCurrent()) {
        input.host.updateSnapshot();
      }
    },
  };
}

type RemoteContainerIngestGeneration = number | undefined;
type RemoteContainerIngestGenerationMap = Map<
  string,
  RemoteContainerIngestGeneration
>;

function isCurrentQueuedRemoteContainer(
  generation: RemoteContainerIngestGeneration,
  generationByContainerId: RemoteContainerIngestGenerationMap,
  queue: RemoteContainerIngestQueue,
  remoteContainer: RemoteContainer,
): boolean {
  return (
    queue.get(remoteContainer.id) === remoteContainer &&
    generationByContainerId.get(remoteContainer.id) === generation
  );
}

async function upsertQueuedRemoteContainer(input: {
  containerIdsWithPendingMetadataUpdates: ReadonlySet<string>;
  containerIdsWithPendingStructuralIntents: ReadonlySet<string>;
  generation: RemoteContainerIngestGeneration;
  generationByContainerId: RemoteContainerIngestGenerationMap;
  host: RemoteContainerHydrationHost;
  isCurrent: () => boolean;
  queue: RemoteContainerIngestQueue;
  queuedRemoteContainer: RemoteContainer;
  state: RemoteContainerHydrationState;
}): Promise<boolean> {
  const {
    containerIdsWithPendingMetadataUpdates,
    containerIdsWithPendingStructuralIntents,
    generation,
    generationByContainerId,
    host,
    queue,
    queuedRemoteContainer,
    state,
  } = input;
  if (
    !input.isCurrent() ||
    !isCurrentQueuedRemoteContainer(
      generation,
      generationByContainerId,
      queue,
      queuedRemoteContainer,
    )
  ) {
    return false;
  }

  const upserted = await upsertRemoteContainerState({
    containerIdsWithPendingMetadataUpdates,
    containerIdsWithPendingStructuralIntents,
    host,
    isCurrent: input.isCurrent,
    remoteContainer: queuedRemoteContainer,
    state,
  });
  if (!upserted) {
    return false;
  }
  return true;
}

function acknowledgeRemoteContainerIngestBatch(input: {
  generation: RemoteContainerIngestGeneration;
  generationByContainerId: RemoteContainerIngestGenerationMap;
  isCurrent: () => boolean;
  queue: RemoteContainerIngestQueue;
  queuedRemoteContainers: ReadonlyArray<RemoteContainer>;
}): void {
  if (!input.isCurrent()) {
    return;
  }
  for (const queuedRemoteContainer of input.queuedRemoteContainers) {
    if (
      isCurrentQueuedRemoteContainer(
        input.generation,
        input.generationByContainerId,
        input.queue,
        queuedRemoteContainer,
      )
    ) {
      input.queue.delete(queuedRemoteContainer.id);
      input.generationByContainerId.delete(queuedRemoteContainer.id);
    }
  }
}

async function drainRemoteContainerIngestQueue(input: {
  generation: RemoteContainerIngestGeneration;
  generationByContainerId: RemoteContainerIngestGenerationMap;
  host: RemoteContainerHydrationHost;
  isCurrent: () => boolean;
  queue: RemoteContainerIngestQueue;
  state: RemoteContainerHydrationState;
}) {
  const { generation, generationByContainerId, host, queue, state } = input;
  let shouldUpdateSnapshot = false;

  try {
    while (input.isCurrent()) {
      const queuedRemoteContainers = Array.from(queue.values()).filter(
        (remoteContainer) =>
          generationByContainerId.get(remoteContainer.id) === generation,
      );
      if (queuedRemoteContainers.length === 0) {
        return;
      }
      await cacheRemoteContainerPrincipalPolicies({
        cacheReferencedPrincipalPolicies: createRuntimePrincipalPolicyWarmer(
          state.runtime,
        ),
        remoteContainers: queuedRemoteContainers,
      });
      if (!input.isCurrent()) {
        return;
      }
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
      if (!input.isCurrent()) {
        return;
      }

      for (const queuedRemoteContainer of queuedRemoteContainers) {
        shouldUpdateSnapshot =
          (await upsertQueuedRemoteContainer({
            containerIdsWithPendingMetadataUpdates,
            containerIdsWithPendingStructuralIntents,
            generation,
            generationByContainerId,
            host,
            isCurrent: input.isCurrent,
            queue,
            queuedRemoteContainer,
            state,
          })) || shouldUpdateSnapshot;
      }
      acknowledgeRemoteContainerIngestBatch({
        generation,
        generationByContainerId,
        isCurrent: input.isCurrent,
        queue,
        queuedRemoteContainers,
      });

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

function isRemoteContainerIngestGenerationCurrent(
  state: RemoteContainerHydrationState,
  generation: RemoteContainerIngestGeneration,
): boolean {
  return (
    state.lifecycleGeneration === undefined ||
    state.lifecycleGeneration === generation
  );
}

function requeueRemoteContainerIngestGeneration(input: {
  generation: RemoteContainerIngestGeneration;
  generationByContainerId: RemoteContainerIngestGenerationMap;
  state: RemoteContainerHydrationState;
}): void {
  for (const [containerId, generation] of input.generationByContainerId) {
    if (generation === input.generation) {
      input.generationByContainerId.set(
        containerId,
        input.state.lifecycleGeneration,
      );
    }
  }
}

interface RemoteContainerIngestor {
  (remoteContainer: RemoteContainer): Promise<void>;
  hasPending: () => boolean;
  resume: () => Promise<void>;
}

export function createRemoteContainerIngestor(input: {
  getSerializationBarrier?: (() => Promise<void> | null) | undefined;
  host: RemoteContainerHydrationHost;
  state: RemoteContainerHydrationState;
}): RemoteContainerIngestor {
  const { host, state } = input;
  const pendingRemoteContainersById: RemoteContainerIngestQueue = new Map();
  const generationByContainerId: RemoteContainerIngestGenerationMap = new Map();
  let ingestRemoteContainersPromise: Promise<void> | null = null;

  const runNextGeneration = (): Promise<void> => {
    if (ingestRemoteContainersPromise) {
      return ingestRemoteContainersPromise.then(
        runNextGeneration,
        runNextGeneration,
      );
    }
    if (
      state.runtime.infra.dbStatus !== undefined &&
      state.runtime.infra.dbStatus !== "ready"
    ) {
      return Promise.resolve();
    }
    const serializationBarrier = input.getSerializationBarrier?.();
    if (serializationBarrier) {
      return serializationBarrier.then(runNextGeneration);
    }
    const nextContainerId = pendingRemoteContainersById.keys().next().value;
    if (typeof nextContainerId !== "string") {
      return Promise.resolve();
    }
    const generation = generationByContainerId.get(nextContainerId);
    const isCurrent = () =>
      isRemoteContainerIngestGenerationCurrent(state, generation);
    const guardedHost = createGenerationGuardedHydrationHost({
      host,
      isCurrent,
    });
    const nextPromise = Promise.resolve()
      .then(() =>
        drainRemoteContainerIngestQueue({
          generation,
          generationByContainerId,
          host: guardedHost,
          isCurrent,
          queue: pendingRemoteContainersById,
          state,
        }),
      )
      .then(() => {
        if (!isCurrent()) {
          requeueRemoteContainerIngestGeneration({
            generation,
            generationByContainerId,
            state,
          });
        }
      })
      .catch((error: unknown) => {
        if (!isCurrent() || error instanceof StaleRemoteHydrationError) {
          requeueRemoteContainerIngestGeneration({
            generation,
            generationByContainerId,
            state,
          });
          return;
        }
        throw error;
      })
      .finally(() => {
        if (ingestRemoteContainersPromise === nextPromise) {
          ingestRemoteContainersPromise = null;
        }
      });
    ingestRemoteContainersPromise = nextPromise;
    return nextPromise.then(() =>
      pendingRemoteContainersById.size > 0 ? runNextGeneration() : undefined,
    );
  };

  const ingestRemoteContainer = (remoteContainer: RemoteContainer) => {
    pendingRemoteContainersById.set(remoteContainer.id, remoteContainer);
    generationByContainerId.set(remoteContainer.id, state.lifecycleGeneration);
    return runNextGeneration();
  };
  ingestRemoteContainer.hasPending = () => pendingRemoteContainersById.size > 0;
  ingestRemoteContainer.resume = runNextGeneration;
  return ingestRemoteContainer;
}

export async function hydrateRemoteContainers(input: {
  followDiscoveredParentLanes?: boolean | undefined;
  host: RemoteContainerHydrationHost;
  isCurrent?: (() => boolean) | undefined;
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
    isCurrent: input.isCurrent,
    lanes,
    queueParentLane: queueDiscoveredParentLane,
    seenContainerIds,
    state,
  });
  const { changedCount } = result;
  await finishRemoteHydration({
    changedCount,
    complete:
      !result.shouldStop &&
      canHydrateRemoteContainers(state) &&
      input.isCurrent?.() !== false,
    containerIdsBeforeHydration,
    host,
    isCurrent: input.isCurrent,
    onFullyHydrated: input.onFullyHydrated,
    seenContainerIds,
    state,
  });
  return changedCount;
}

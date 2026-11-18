import { cacheRemoteContainerPrincipalPolicies } from "./principalPolicyCache";
import { loadPausedContainerFilter } from "./remoteContainers/organizationSyncPauseFilter";
import {
  listRemoteContainerIdsWithPendingMetadataUpdates,
  listRemoteContainerIdsWithPendingStructuralIntents,
  upsertIsolatedRemoteContainerState,
} from "./remoteContainers/remoteContainerState";
import type {
  RemoteContainer,
  RemoteContainerHydrationHost,
  RemoteContainerHydrationState,
  RemoteContainerIngestQueue,
} from "./types";

export { hydrateRemoteContainers } from "./hydrateRemoteContainers";
export type {
  ContainerState,
  HydrationOutcome,
  PersistContainerStateResult,
  ReconnectCrawl,
  RemoteContainer,
  RemoteContainerHydrationHost,
} from "./types";

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
    ...(input.host.requestMetadataRevalidation
      ? {
          requestMetadataRevalidation: async (request) => {
            assertCurrent();
            await input.host.requestMetadataRevalidation?.(request);
            assertCurrent();
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

interface RemoteContainerIngestGeneration {
  readonly lifecycle: number | undefined;
  readonly structural: number | undefined;
}
type RemoteContainerIngestGenerationMap = Map<
  string,
  RemoteContainerIngestGeneration
>;

function remoteContainerIngestGeneration(
  state: RemoteContainerHydrationState,
): RemoteContainerIngestGeneration {
  return {
    lifecycle: state.lifecycleGeneration,
    structural: state.structuralGeneration,
  };
}

function remoteContainerIngestGenerationsMatch(
  left: RemoteContainerIngestGeneration | undefined,
  right: RemoteContainerIngestGeneration,
): boolean {
  return (
    left !== undefined &&
    left.lifecycle === right.lifecycle &&
    left.structural === right.structural
  );
}

function isCurrentQueuedRemoteContainer(
  generation: RemoteContainerIngestGeneration,
  generationByContainerId: RemoteContainerIngestGenerationMap,
  queue: RemoteContainerIngestQueue,
  remoteContainer: RemoteContainer,
): boolean {
  return (
    queue.get(remoteContainer.id) === remoteContainer &&
    remoteContainerIngestGenerationsMatch(
      generationByContainerId.get(remoteContainer.id),
      generation,
    )
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

  // A paused organization's container is acknowledged without being applied,
  // including when the pause lands while the commit is in flight.
  const isPaused = await loadPausedContainerFilter(state);
  if (isPaused(queuedRemoteContainer)) return true;
  const tombstones = await state.persistence.loadContainerHydrationTombstones(
    state.runtime.infra.execSql,
  );
  // A refused folder is reported and acknowledged; the batch continues.
  const upserted = await upsertIsolatedRemoteContainerState({
    expectedHydrationTombstone:
      tombstones.find((row) => row.containerId === queuedRemoteContainer.id) ??
      null,
    containerIdsWithPendingMetadataUpdates,
    containerIdsWithPendingStructuralIntents,
    host,
    isCurrent: () => input.isCurrent() && !isPaused(queuedRemoteContainer),
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
          remoteContainerIngestGenerationsMatch(
            generationByContainerId.get(remoteContainer.id),
            generation,
          ),
      );
      if (queuedRemoteContainers.length === 0) {
        return;
      }
      await cacheRemoteContainerPrincipalPolicies({
        cacheReferencedPrincipalPolicies:
          state.runtime.principalPolicies.createWarmer(),
        remoteContainers: queuedRemoteContainers,
        stillCurrent: input.isCurrent,
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
  return remoteContainerIngestGenerationsMatch(
    remoteContainerIngestGeneration(state),
    generation,
  );
}

function settleStaleRemoteContainerIngestGeneration(input: {
  generation: RemoteContainerIngestGeneration;
  generationByContainerId: RemoteContainerIngestGenerationMap;
  queue: RemoteContainerIngestQueue;
  state: RemoteContainerHydrationState;
}): void {
  const currentGeneration = remoteContainerIngestGeneration(input.state);
  const shouldReplay =
    currentGeneration.lifecycle !== input.generation.lifecycle &&
    currentGeneration.structural === input.generation.structural;
  for (const [containerId, generation] of input.generationByContainerId) {
    if (!remoteContainerIngestGenerationsMatch(generation, input.generation)) {
      continue;
    }
    if (shouldReplay) {
      input.generationByContainerId.set(containerId, currentGeneration);
    } else {
      input.generationByContainerId.delete(containerId);
      input.queue.delete(containerId);
    }
  }
}

interface RemoteContainerIngestor {
  (remoteContainer: RemoteContainer): Promise<void>;
  hasPending: () => boolean;
  resume: () => Promise<void>;
}

export function createRemoteContainerIngestor(input: {
  ownsScope?: () => boolean;
  getSerializationBarrier?: (() => Promise<void> | null) | undefined;
  host: RemoteContainerHydrationHost;
  state: RemoteContainerHydrationState;
}): RemoteContainerIngestor {
  const { host, state } = input;
  const pendingRemoteContainersById: RemoteContainerIngestQueue = new Map();
  const generationByContainerId: RemoteContainerIngestGenerationMap = new Map();
  let ingestRemoteContainersPromise: Promise<void> | null = null;

  const settleStale = (generation: RemoteContainerIngestGeneration) =>
    settleStaleRemoteContainerIngestGeneration({
      generation,
      generationByContainerId,
      queue: pendingRemoteContainersById,
      state,
    });

  const runNextGeneration = (): Promise<void> => {
    if (input.ownsScope?.() === false) {
      pendingRemoteContainersById.clear();
      generationByContainerId.clear();
      return Promise.resolve();
    }
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
    if (!generation) {
      pendingRemoteContainersById.delete(nextContainerId);
      return runNextGeneration();
    }
    const isCurrent = () =>
      input.ownsScope?.() !== false &&
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
        if (!isCurrent()) settleStale(generation);
      })
      .catch((error: unknown) => {
        if (!isCurrent() || error instanceof StaleRemoteHydrationError) {
          settleStale(generation);
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
    generationByContainerId.set(
      remoteContainer.id,
      remoteContainerIngestGeneration(state),
    );
    return runNextGeneration();
  };
  ingestRemoteContainer.hasPending = () => pendingRemoteContainersById.size > 0;
  ingestRemoteContainer.resume = runNextGeneration;
  return ingestRemoteContainer;
}

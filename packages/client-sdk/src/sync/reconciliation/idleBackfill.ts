import type { InitialDocumentProbe } from "./initialDocumentProbe";
import type { ReconcileQueue } from "./queue";
import type { ReconciliationHost } from "./serviceTypes";

export interface IdleBackfillState {
  activeContainerId: string | null;
  automaticRetryGenerations: Map<string, number>;
  discoveredContainerIds: Set<string>;
  forcedContainerGenerations: Map<string, number>;
  initialDocumentProbe: InitialDocumentProbe;
  nextForceGeneration: number;
  queue: ReconcileQueue;
  unscopedInvalidationActive: boolean;
  unscopedInvalidatedContainerIds: Set<string>;
}

export function markContainerForced(
  state: IdleBackfillState,
  containerId: string,
): void {
  state.nextForceGeneration += 1;
  state.automaticRetryGenerations.delete(containerId);
  state.forcedContainerGenerations.set(containerId, state.nextForceGeneration);
}

export function acknowledgeContainerForce(
  state: IdleBackfillState,
  containerId: string,
  generation: number | undefined,
): void {
  if (state.forcedContainerGenerations.get(containerId) === generation) {
    state.forcedContainerGenerations.delete(containerId);
    state.automaticRetryGenerations.delete(containerId);
  }
}

function needsForcedContainerActivation(
  state: IdleBackfillState,
  containerId: string,
): boolean {
  if (
    state.unscopedInvalidationActive &&
    !state.unscopedInvalidatedContainerIds.has(containerId)
  ) {
    state.unscopedInvalidatedContainerIds.add(containerId);
    return true;
  }
  return state.forcedContainerGenerations.has(containerId);
}

export function activateContainer(
  state: IdleBackfillState,
  containerId: string | null,
  enqueue: (containerId: string, force: boolean) => void,
): void {
  state.activeContainerId = containerId;
  if (containerId) {
    enqueue(containerId, needsForcedContainerActivation(state, containerId));
  }
}

export function enqueueKnownContainersForIdleBackfill(input: {
  force: boolean;
  host: ReconciliationHost;
  scheduleDrain: () => void;
  state: IdleBackfillState;
}): void {
  const { force, host, scheduleDrain, state } = input;
  if (force) {
    state.unscopedInvalidationActive = true;
    state.unscopedInvalidatedContainerIds.clear();
  }

  const knownContainerIds = host.listKnownContainerIds();
  const activeContainerId = state.activeContainerId;
  const backfillContainerIds =
    activeContainerId !== null &&
    !knownContainerIds.includes(activeContainerId) &&
    (state.unscopedInvalidationActive ||
      host.canDiscoverContainerDocuments(activeContainerId))
      ? [...knownContainerIds, activeContainerId]
      : knownContainerIds;
  state.initialDocumentProbe.arm(
    backfillContainerIds.filter((id) => host.canDiscoverContainerDocuments(id)),
  );
  for (const containerId of backfillContainerIds) {
    const needsUnscopedForce =
      state.unscopedInvalidationActive &&
      !state.unscopedInvalidatedContainerIds.has(containerId);
    const shouldForce =
      needsUnscopedForce || state.forcedContainerGenerations.has(containerId);
    if (!shouldForce && state.discoveredContainerIds.has(containerId)) {
      continue;
    }
    if (needsUnscopedForce) {
      markContainerForced(state, containerId);
      state.unscopedInvalidatedContainerIds.add(containerId);
    }
    state.queue.enqueue(containerId, "idle");
  }
  scheduleDrain();
}

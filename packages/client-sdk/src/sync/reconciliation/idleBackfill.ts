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

export function activateContainer(
  state: IdleBackfillState,
  containerId: string | null,
  enqueue: (containerId: string, force: boolean) => void,
): void {
  state.activeContainerId = containerId;
  if (containerId) {
    enqueue(containerId, state.forcedContainerGenerations.has(containerId));
  }
}

export function enqueueKnownContainersForIdleBackfill(input: {
  host: ReconciliationHost;
  scheduleDrain: () => void;
  state: IdleBackfillState;
}): void {
  const { host, scheduleDrain, state } = input;
  const knownContainerIds = host.listKnownContainerIds();
  const activeContainerId = state.activeContainerId;
  const backfillContainerIds =
    activeContainerId !== null &&
    !knownContainerIds.includes(activeContainerId) &&
    host.canDiscoverContainerDocuments(activeContainerId)
      ? [...knownContainerIds, activeContainerId]
      : knownContainerIds;
  state.initialDocumentProbe.arm(
    backfillContainerIds.filter((id) => host.canDiscoverContainerDocuments(id)),
  );
  for (const containerId of backfillContainerIds) {
    const shouldForce = state.forcedContainerGenerations.has(containerId);
    if (!shouldForce && state.discoveredContainerIds.has(containerId)) {
      continue;
    }
    state.queue.enqueue(containerId, "idle");
  }
  scheduleDrain();
}

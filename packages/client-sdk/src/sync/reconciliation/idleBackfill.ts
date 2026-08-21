import type { InitialDocumentProbe } from "./initialDocumentProbe";
import type { ReconcileQueue } from "./queue";
import type { ReconciliationHost } from "./serviceTypes";

export interface IdleBackfillState {
  discoveredContainerIds: Set<string>;
  forcedContainerIds: Set<string>;
  initialDocumentProbe: InitialDocumentProbe;
  queue: ReconcileQueue;
  unscopedInvalidationActive: boolean;
  unscopedInvalidatedContainerIds: Set<string>;
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
  state.initialDocumentProbe.arm(
    knownContainerIds.filter((id) => host.canDiscoverContainerDocuments(id)),
  );
  for (const containerId of knownContainerIds) {
    const needsUnscopedForce =
      state.unscopedInvalidationActive &&
      !state.unscopedInvalidatedContainerIds.has(containerId);
    const shouldForce =
      needsUnscopedForce || state.forcedContainerIds.has(containerId);
    if (!shouldForce && state.discoveredContainerIds.has(containerId)) {
      continue;
    }
    if (shouldForce) {
      state.forcedContainerIds.add(containerId);
      state.unscopedInvalidatedContainerIds.add(containerId);
    }
    state.queue.enqueue(containerId, "idle");
  }
  scheduleDrain();
}

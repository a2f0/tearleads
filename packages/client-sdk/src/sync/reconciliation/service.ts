import type { DomainScope } from "../../data/domainScope";
import {
  getOrCreateDomainSyncCoordinator,
  type SyncLane,
} from "../../data/sync/syncCoordinator";
import type { LocalProjectionReconciledDelta } from "../../stores/local-projection";
import {
  createReconcileQueue,
  type ReconcilePriority,
  type ReconcileQueue,
} from "./queue";

export interface ReconciliationRuntimeStatus {
  dbStatus: string;
  isAuthenticated: boolean;
  online: boolean;
}

/**
 * Host contract injected by the device-first facade. Keeps the reconciler
 * React-free and decoupled from runtime/persistence construction — it only
 * orchestrates *when* these run and routes their results into Layer A.
 */
export interface ReconciliationHost {
  domainScope: DomainScope;
  getRuntimeStatus: () => ReconciliationRuntimeStatus;
  /** Known container ids, used for idle backfill and event mapping. */
  listKnownContainerIds: () => ReadonlyArray<string>;
  /** Discover + persist a container's documents from the server. */
  discoverContainerDocuments: (containerId: string) => Promise<unknown>;
  /** Read a container's freshly-persisted summaries+links from SQLite. */
  loadContainerDelta: (
    containerId: string,
  ) => Promise<LocalProjectionReconciledDelta>;
  /** Push a reconciled delta into the local projection store. */
  applyReconciled: (delta: LocalProjectionReconciledDelta) => void;
  /** Refresh the container tree + all container documents (explicit refresh). */
  refreshTreeAndAllDocuments: () => Promise<void>;
  /** True if the destroyed-db error should be swallowed rather than surfaced. */
  isIgnorableError: (error: unknown) => boolean;
}

export interface ReconciliationService {
  start: () => void;
  setActiveContainer: (containerId: string | null) => void;
  enqueueContainer: (containerId: string, priority: ReconcilePriority) => void;
  enqueueIdleBackfill: () => void;
  reconcileNow: () => Promise<void>;
  stop: () => void;
}

function canReconcile(status: ReconciliationRuntimeStatus): boolean {
  return status.dbStatus === "ready" && status.isAuthenticated && status.online;
}

interface ReconciliationState {
  active: boolean;
  activeContainerId: string | null;
  discoveredContainerIds: Set<string>;
  lane: SyncLane | null;
  queue: ReconcileQueue;
}

async function reconcileOneContainer(
  host: ReconciliationHost,
  containerId: string,
): Promise<void> {
  try {
    await host.discoverContainerDocuments(containerId);
    const delta = await host.loadContainerDelta(containerId);
    host.applyReconciled(delta);
  } catch (error) {
    if (host.isIgnorableError(error)) {
      return;
    }
    throw error;
  }
}

async function runReconcileLane(
  host: ReconciliationHost,
  state: ReconciliationState,
): Promise<void> {
  if (!canReconcile(host.getRuntimeStatus())) {
    return;
  }

  const containerId = state.queue.dequeue();
  if (!containerId) {
    return;
  }

  await reconcileOneContainer(host, containerId);
  state.discoveredContainerIds.add(containerId);

  // Keep draining: schedule another pass while the queue holds work.
  if (state.queue.size > 0) {
    state.lane?.requestSync();
  }
}

export function createReconciliationService(
  host: ReconciliationHost,
): ReconciliationService {
  const state: ReconciliationState = {
    active: false,
    activeContainerId: null,
    discoveredContainerIds: new Set(),
    lane: null,
    queue: createReconcileQueue(),
  };

  const scheduleDrain = () => {
    if (!state.active || state.queue.size === 0) {
      return;
    }
    if (!canReconcile(host.getRuntimeStatus())) {
      return;
    }
    state.lane?.requestSync();
  };

  const enqueueContainer = (
    containerId: string,
    priority: ReconcilePriority,
  ) => {
    if (!containerId) {
      return;
    }
    state.queue.enqueue(containerId, priority);
    scheduleDrain();
  };

  const enqueueIdleBackfill = () => {
    for (const containerId of host.listKnownContainerIds()) {
      if (containerId === state.activeContainerId) {
        continue;
      }
      state.queue.enqueue(containerId, "idle");
    }
    scheduleDrain();
  };

  return {
    start: () => {
      if (state.active) {
        return;
      }
      state.active = true;
      state.lane = getOrCreateDomainSyncCoordinator(
        host.domainScope,
      ).registerLane("reconciliation:documents", {
        label: "Device-first document reconciliation",
        // Document discovery runs in the document phase, after structural
        // container hydration/metadata sync settles for the scope.
        phase: "document",
        onUnexpectedError: (error) => {
          console.error("Device-first reconciliation failed:", error);
        },
        run: () => runReconcileLane(host, state),
        shouldIgnoreError: host.isIgnorableError,
      });
      scheduleDrain();
    },
    setActiveContainer: (containerId) => {
      state.activeContainerId = containerId;
      if (containerId) {
        // Active container is reconciled first; siblings backfill at idle.
        enqueueContainer(containerId, "active");
        enqueueIdleBackfill();
      }
    },
    enqueueContainer,
    enqueueIdleBackfill,
    reconcileNow: async () => {
      if (!canReconcile(host.getRuntimeStatus())) {
        return;
      }
      try {
        await host.refreshTreeAndAllDocuments();
      } catch (error) {
        if (!host.isIgnorableError(error)) {
          throw error;
        }
      }
    },
    stop: () => {
      state.active = false;
      state.queue.clear();
    },
  };
}

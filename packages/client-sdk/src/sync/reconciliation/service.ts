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
  /** Refresh the container tree from the server (explicit refresh). */
  refreshTree: () => Promise<void>;
  /** True if the destroyed-db error should be swallowed rather than surfaced. */
  isIgnorableError: (error: unknown) => boolean;
}

export interface ReconciliationService {
  start: () => void;
  setActiveContainer: (containerId: string | null) => void;
  enqueueContainer: (
    containerId: string,
    priority: ReconcilePriority,
    force?: boolean,
  ) => void;
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

  // Double-check at run time: a container may have been discovered (by an
  // explicit refresh or an earlier lane pass) after it was queued. Marking it
  // discovered up front also collapses concurrent re-enqueues into one fetch.
  if (!state.discoveredContainerIds.has(containerId)) {
    state.discoveredContainerIds.add(containerId);
    await reconcileOneContainer(host, containerId);
  }

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
    force = false,
  ) => {
    if (!containerId) {
      return;
    }
    // Skip containers already reconciled this session unless forced. Events
    // force re-discovery; passive active/backfill scheduling does not, so
    // opening Explorer does not re-fetch every container on each navigation.
    if (!force && state.discoveredContainerIds.has(containerId)) {
      return;
    }
    state.queue.enqueue(containerId, priority);
    scheduleDrain();
  };

  const enqueueIdleBackfill = () => {
    for (const containerId of host.listKnownContainerIds()) {
      if (
        containerId === state.activeContainerId ||
        state.discoveredContainerIds.has(containerId)
      ) {
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
        // Reconcile the active container first. Siblings are not eagerly
        // swept here — they reconcile when visited (each becomes active) or on
        // an explicit refresh — which keeps first-open network minimal.
        enqueueContainer(containerId, "active");
      }
    },
    enqueueContainer,
    enqueueIdleBackfill,
    reconcileNow: async () => {
      if (!canReconcile(host.getRuntimeStatus())) {
        return;
      }
      // Explicit refresh: refresh the tree, then re-discover every known
      // container exactly once. Discovery flows through this single path (not
      // the background lane and a separate bulk sweep), so each container is
      // fetched once.
      state.queue.clear();
      try {
        await host.refreshTree();
        const knownIds = host.listKnownContainerIds();
        // Mark known containers discovered so the background lane will not also
        // fetch them while this refresh sweeps. Each is still fetched directly
        // below — discovery is watermark-based, so this is a cheap delta check.
        for (const containerId of knownIds) {
          state.discoveredContainerIds.add(containerId);
        }
        for (const containerId of knownIds) {
          // reconcileOneContainer discovers, reloads the delta, and applies it.
          await reconcileOneContainer(host, containerId);
        }
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

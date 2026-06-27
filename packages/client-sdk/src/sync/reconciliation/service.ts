import type { DocumentSummary } from "../../data/documentSummary";
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
  /** Force a document body pull for documents refreshed without an event. */
  requestDocumentContentPull?: (
    documents: ReadonlyArray<DocumentSummary>,
  ) => void;
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
  /**
   * Forget which containers were reconciled this session so the next enqueue of
   * each re-validates against the server exactly once. Call on the
   * cannot-reconcile → can-reconcile edge (relogin/reconnect): the discovered
   * set is a per-session suppression cache, and a previously-visited container
   * may have changed remotely while this client could not reach the server.
   */
  resetDiscovered: () => void;
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
  forcedContainerIds: Set<string>;
  lane: SyncLane | null;
  queue: ReconcileQueue;
}

async function reconcileOneContainer(
  host: ReconciliationHost,
  containerId: string,
  options: { forceDocumentContentPull?: boolean } = {},
): Promise<void> {
  try {
    await host.discoverContainerDocuments(containerId);
    const delta = await host.loadContainerDelta(containerId);
    host.applyReconciled(delta);
    if (options.forceDocumentContentPull) {
      host.requestDocumentContentPull?.(delta.documentSummaries);
    }
  } catch (error) {
    if (host.isIgnorableError(error)) {
      return;
    }
    throw error;
  }
}

async function sweepKnownContainers(
  host: ReconciliationHost,
  state: ReconciliationState,
): Promise<void> {
  const knownIds = host.listKnownContainerIds();
  // Mark known containers discovered so the background lane will not also fetch
  // them while this refresh sweeps. Each is still fetched directly below —
  // discovery is watermark-based, so this is a cheap delta check.
  for (const containerId of knownIds) {
    state.discoveredContainerIds.add(containerId);
  }
  // Reconcile every container independently: one failing container must not
  // block refreshing the rest. Surface the first real error after the sweep.
  let firstError: unknown;
  for (const containerId of knownIds) {
    try {
      await reconcileOneContainer(host, containerId, {
        forceDocumentContentPull: true,
      });
    } catch (error) {
      if (!host.isIgnorableError(error) && firstError === undefined) {
        firstError = error;
      }
      state.discoveredContainerIds.delete(containerId);
    }
  }
  if (firstError !== undefined) {
    throw firstError;
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
  // explicit refresh or an earlier lane pass) after it was queued. Mark it
  // discovered up front to collapse concurrent re-enqueues into one fetch, but
  // roll the mark back on failure so a transient error can be retried later.
  const shouldForce = state.forcedContainerIds.delete(containerId);
  if (shouldForce || !state.discoveredContainerIds.has(containerId)) {
    state.discoveredContainerIds.add(containerId);
    try {
      await reconcileOneContainer(host, containerId);
    } catch (error) {
      state.discoveredContainerIds.delete(containerId);
      throw error;
    }
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
    forcedContainerIds: new Set(),
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
    if (force) {
      state.forcedContainerIds.add(containerId);
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
    resetDiscovered: () => {
      state.discoveredContainerIds.clear();
    },
    reconcileNow: async () => {
      if (!canReconcile(host.getRuntimeStatus())) {
        return;
      }
      // Explicit refresh: refresh the tree, then re-discover every known
      // container exactly once via a single path (not the background lane and a
      // separate bulk sweep), so each container is fetched once.
      state.queue.clear();
      state.forcedContainerIds.clear();
      try {
        await host.refreshTree();
        await sweepKnownContainers(host, state);
      } catch (error) {
        if (!host.isIgnorableError(error)) {
          throw error;
        }
      }
    },
    stop: () => {
      state.active = false;
      state.queue.clear();
      state.forcedContainerIds.clear();
      // Drop the per-session discovered suppression cache too: a stopped
      // reconciler is being torn down (scope/identity change) or paused across
      // a prerequisite loss, after which every container must be re-validated.
      state.discoveredContainerIds.clear();
    },
  };
}

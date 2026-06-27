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
  /** Refresh only the top-level root lane from the server. */
  refreshRootTree: () => Promise<void>;
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
  reconcileRootContainersNow: () => Promise<void>;
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
  /**
   * In-flight sweep promise. {@link reconcileKnownContainersAfterRefresh}
   * clears the queue/forced set and mutates the discovered set non-atomically,
   * so two overlapping sweeps (e.g. the open catch-up racing a manual refresh)
   * would tear each other's shared state. Callers share one promise instead of
   * starting a second one underneath it — see
   * {@link reconcileKnownContainersSingleFlight} for how root vs full sweeps
   * coalesce or chain.
   */
  refreshPromise: Promise<void> | null;
  /**
   * Scope of the in-flight {@link refreshPromise}. A root-only sweep only
   * refreshes the top-level lane, so a full sweep must not coalesce into it
   * (that would skip whole-tree discovery); it chains after instead. A full
   * sweep is a superset, so anything coalesces into an in-flight full.
   */
  refreshType: "root" | "full" | null;
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

async function reconcileKnownContainersAfterRefresh(input: {
  host: ReconciliationHost;
  refreshTree: () => Promise<void>;
  state: ReconciliationState;
}): Promise<void> {
  const { host, refreshTree, state } = input;
  if (!canReconcile(host.getRuntimeStatus())) {
    return;
  }

  state.queue.clear();
  state.forcedContainerIds.clear();
  try {
    await refreshTree();
    await sweepKnownContainers(host, state);
  } catch (error) {
    if (!host.isIgnorableError(error)) {
      throw error;
    }
  }
}

// Serialize the sweep entry points (reconcileNow / reconcileRootContainersNow)
// so they never run concurrently over the shared state. A second caller while a
// sweep is in flight joins it instead of clearing the queue/discovered set
// underneath the first — but a full sweep must NOT coalesce into an in-flight
// root-only sweep, since the root-only sweep skips whole-tree discovery. In
// that one case the full sweep is chained to run after the root-only sweep.
function reconcileKnownContainersSingleFlight(
  host: ReconciliationHost,
  state: ReconciliationState,
  refreshTree: () => Promise<void>,
  type: "root" | "full",
): Promise<void> {
  const startSweep = (previous?: Promise<void>): Promise<void> => {
    const refreshPromise = (previous ?? Promise.resolve())
      // A chained full sweep ignores the prior sweep's outcome; its own
      // try/catch in reconcileKnownContainersAfterRefresh handles its errors.
      .catch(() => undefined)
      .then(() =>
        reconcileKnownContainersAfterRefresh({ host, refreshTree, state }),
      )
      .finally(() => {
        if (state.refreshPromise === refreshPromise) {
          state.refreshPromise = null;
          state.refreshType = null;
        }
      });
    state.refreshPromise = refreshPromise;
    state.refreshType = type;
    return refreshPromise;
  };

  if (!state.refreshPromise) {
    return startSweep();
  }
  // An in-flight full sweep already covers any request; a root request coalesces
  // into whatever is in flight. Only a full request waiting on a root sweep
  // needs to chain so the whole-tree refresh still runs.
  if (type === "root" || state.refreshType === "full") {
    return state.refreshPromise;
  }
  return startSweep(state.refreshPromise);
}

function startReconciliationLane(
  host: ReconciliationHost,
  state: ReconciliationState,
): void {
  if (state.active) {
    return;
  }
  state.active = true;
  state.lane = getOrCreateDomainSyncCoordinator(host.domainScope).registerLane(
    "reconciliation:documents",
    {
      label: "Device-first document reconciliation",
      // Document discovery runs in the document phase, after structural
      // container hydration/metadata sync settles for the scope.
      phase: "document",
      onUnexpectedError: (error) => {
        console.error("Device-first reconciliation failed:", error);
      },
      run: () => runReconcileLane(host, state),
      shouldIgnoreError: host.isIgnorableError,
    },
  );
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
    refreshPromise: null,
    refreshType: null,
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
      startReconciliationLane(host, state);
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
    reconcileRootContainersNow: () =>
      reconcileKnownContainersSingleFlight(
        host,
        state,
        host.refreshRootTree,
        "root",
      ),
    reconcileNow: () =>
      reconcileKnownContainersSingleFlight(
        host,
        state,
        host.refreshTree,
        "full",
      ),
    stop: () => {
      state.active = false;
      state.queue.clear();
      state.forcedContainerIds.clear();
      state.refreshPromise = null;
      state.refreshType = null;
      // Drop the per-session discovered suppression cache too: a stopped
      // reconciler is being torn down (scope/identity change) or paused across
      // a prerequisite loss, after which every container must be re-validated.
      state.discoveredContainerIds.clear();
    },
  };
}

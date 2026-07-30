import type { DocumentSummary } from "../../data/documentSummary";
import type { DomainScope } from "../../data/domainScope";
import {
  getOrCreateDomainSyncCoordinator,
  type SyncLane,
} from "../../data/sync/syncCoordinator";
import type { LocalProjectionReconciledDelta } from "../../stores/local-projection";
import {
  createInitialDocumentProbe,
  type InitialDocumentProbe,
  type InitialDocumentProbeHost,
  scheduleInitialDocumentProbeContinuation,
} from "./initialDocumentProbe";
import { clearOriginatedDocuments } from "./originatedDocuments";
import {
  createReconcileQueue,
  type ReconcilePriority,
  type ReconcileQueue,
} from "./queue";
import { listFullRefreshContainerIds } from "./refreshContainerIds";

export interface ReconciliationRuntimeStatus {
  dbStatus: string;
  isAuthenticated: boolean;
  online: boolean;
}

/** Device-first scheduling host; runtime and persistence stay injected. */
export interface ReconciliationHost extends InitialDocumentProbeHost {
  domainScope: DomainScope;
  getRuntimeStatus: () => ReconciliationRuntimeStatus;
  listAutomaticRootCatchupContainerIds: () => ReadonlyArray<string>;
  /** Discover + persist a container's documents from the server. */
  discoverContainerDocuments: (
    containerId: string,
  ) => Promise<ReadonlyArray<DocumentSummary> | null>;
  /** Read a container's freshly-persisted summaries+links from SQLite. */
  loadContainerDelta: (
    containerId: string,
  ) => Promise<LocalProjectionReconciledDelta>;
  /** Push a reconciled delta into the local projection store. */
  applyReconciled: (delta: LocalProjectionReconciledDelta) => void;
  /**
   * Sync document bodies for a reconciled container. `force` (an explicit
   * refresh) revalidates registered ordinary documents and retries system
   * documents; otherwise only unopened system documents are synced, so a
   * background pass can materialize projection-owned content without eagerly
   * opening every ordinary document.
   */
  requestDocumentContentPull?: (
    containerId: string,
    documents: ReadonlyArray<DocumentSummary>,
    force: boolean,
  ) => void;
  /** Refresh the container tree from the server (explicit refresh). */
  refreshTree: () => Promise<void>;
  /** Refresh only the top-level root lane from the server. */
  refreshRootTree: () => Promise<void>;
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
  initialDocumentProbe: InitialDocumentProbe;
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
): Promise<boolean> {
  // Structural hydration can replace a queued local root/system id before the
  // document phase runs. Re-check current state at dequeue/sweep time so that
  // stale, never-remote ids do not leak into /containers/:id/documents.
  if (!host.canDiscoverContainerDocuments(containerId)) {
    return false;
  }

  try {
    await host.discoverContainerDocuments(containerId);
    const delta = await host.loadContainerDelta(containerId);
    host.applyReconciled(delta);
    // Always offer the delta for content sync. A forced pull (explicit refresh)
    // revalidates registered ordinary documents and retries system documents;
    // an unforced pass only opens system documents, whose local projections may
    // have no document window that would otherwise materialize them.
    host.requestDocumentContentPull?.(
      containerId,
      delta.documentSummaries,
      options.forceDocumentContentPull ?? false,
    );
    return true;
  } catch (error) {
    if (host.isIgnorableError(error)) {
      return true;
    }
    throw error;
  }
}

async function sweepKnownContainers(
  host: ReconciliationHost,
  state: ReconciliationState,
  knownIds: ReadonlyArray<string>,
  forceAllDocumentContentPulls: boolean,
): Promise<void> {
  const containerIds = forceAllDocumentContentPulls
    ? knownIds
    : knownIds.filter(
        (containerId) =>
          state.forcedContainerIds.has(containerId) ||
          !state.discoveredContainerIds.has(containerId),
      );
  // Mark only the containers this sweep will fetch. Automatic root hints are
  // discovery signals, so already-reconciled containers stay settled unless a
  // targeted event forced them; explicit full refreshes still fetch every id.
  for (const containerId of containerIds) {
    state.discoveredContainerIds.add(containerId);
  }
  // Reconcile every container independently: one failing container must not
  // block refreshing the rest. Surface the first real error after the sweep.
  let firstError: unknown;
  for (const containerId of containerIds) {
    try {
      const forceDocumentContentPull =
        forceAllDocumentContentPulls ||
        state.forcedContainerIds.delete(containerId);
      const reconciled = await reconcileOneContainer(host, containerId, {
        forceDocumentContentPull,
      });
      if (!reconciled) {
        state.discoveredContainerIds.delete(containerId);
      }
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
    await state.initialDocumentProbe.run();
    scheduleProbeContinuation(host, state);
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
      const reconciled = await reconcileOneContainer(host, containerId, {
        forceDocumentContentPull: shouldForce,
      });
      if (!reconciled) {
        state.discoveredContainerIds.delete(containerId);
      }
    } catch (error) {
      state.discoveredContainerIds.delete(containerId);
      throw error;
    }
  }

  // Keep draining: schedule another pass while the queue holds work.
  if (state.queue.size > 0) {
    state.lane?.requestSync();
  } else {
    scheduleProbeContinuation(host, state);
  }
}

function scheduleProbeContinuation(
  host: ReconciliationHost,
  state: ReconciliationState,
): void {
  scheduleInitialDocumentProbeContinuation({
    canContinue: () =>
      state.active &&
      state.queue.size === 0 &&
      canReconcile(host.getRuntimeStatus()) &&
      state.initialDocumentProbe.canRun(),
    requestRun: () => state.lane?.requestSync(),
  });
}

function forgetIneligibleDiscoveredContainers(
  host: ReconciliationHost,
  state: ReconciliationState,
): void {
  for (const containerId of state.discoveredContainerIds) {
    if (!host.canDiscoverContainerDocuments(containerId)) {
      state.discoveredContainerIds.delete(containerId);
    }
  }
}

async function reconcileKnownContainersAfterRefresh(input: {
  forceAllDocumentContentPulls: boolean;
  host: ReconciliationHost;
  listContainerIds: () => ReadonlyArray<string>;
  refreshTree: () => Promise<void>;
  state: ReconciliationState;
}): Promise<void> {
  const { host, listContainerIds, refreshTree, state } = input;
  if (!canReconcile(host.getRuntimeStatus())) {
    return;
  }

  if (input.forceAllDocumentContentPulls) {
    state.queue.clear();
    state.forcedContainerIds.clear();
  }
  try {
    // A resync_required structural refresh runs independently of this service.
    // If it already removed a container after the forced document lane won its
    // race against the old tree, forget the stale discovered bit before this
    // refresh can re-add the same id.
    forgetIneligibleDiscoveredContainers(host, state);
    await refreshTree();
    // Structural hydration can revoke and remove a container after a targeted
    // force already reconciled it against the old tree. Forget every id that
    // is no longer remotely listable so a later share of the same container id
    // is treated as newly surfaced instead of being suppressed for the rest of
    // the session.
    forgetIneligibleDiscoveredContainers(host, state);
    await sweepKnownContainers(
      host,
      state,
      listContainerIds(),
      input.forceAllDocumentContentPulls,
    );
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
  listContainerIds: () => ReadonlyArray<string>,
  type: "root" | "full",
): Promise<void> {
  const startSweep = (previous?: Promise<void>): Promise<void> => {
    const refreshPromise = (previous ?? Promise.resolve())
      // A chained full sweep ignores the prior sweep's outcome; its own
      // try/catch in reconcileKnownContainersAfterRefresh handles its errors.
      .catch(() => undefined)
      .then(() =>
        reconcileKnownContainersAfterRefresh({
          forceAllDocumentContentPulls: type === "full",
          host,
          listContainerIds,
          refreshTree,
          state,
        }),
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

function createReconciliationState(
  host: ReconciliationHost,
): ReconciliationState {
  return {
    active: false,
    activeContainerId: null,
    discoveredContainerIds: new Set(),
    forcedContainerIds: new Set(),
    initialDocumentProbe: createInitialDocumentProbe(host),
    lane: null,
    queue: createReconcileQueue(),
    refreshPromise: null,
    refreshType: null,
  };
}

export function createReconciliationService(
  host: ReconciliationHost,
): ReconciliationService {
  const state = createReconciliationState(host);

  const scheduleDrain = () => {
    if (
      !state.active ||
      (state.queue.size === 0 && !state.initialDocumentProbe.canRun())
    ) {
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
    state.initialDocumentProbe.arm();
    for (const containerId of host.listKnownContainerIds()) {
      if (state.discoveredContainerIds.has(containerId)) {
        continue;
      }
      // Queue dedupe already collapses an active+idle enqueue of the same id.
      // Do not skip the active id here: a local-first active container may have
      // been dropped as ineligible, then become remote-backed under the same id
      // and rely on a remote-containers-added backfill to re-arm it.
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
      state.initialDocumentProbe.resetPending();
    },
    reconcileRootContainersNow: () =>
      reconcileKnownContainersSingleFlight(
        host,
        state,
        host.refreshRootTree,
        host.listAutomaticRootCatchupContainerIds,
        "root",
      ),
    reconcileNow: () =>
      reconcileKnownContainersSingleFlight(
        host,
        state,
        host.refreshTree,
        () => listFullRefreshContainerIds(host, state.activeContainerId),
        "full",
      ),
    stop: () => {
      state.active = false;
      state.queue.clear();
      state.forcedContainerIds.clear();
      state.refreshPromise = null;
      state.refreshType = null;
      state.initialDocumentProbe.resetPending();
      // Drop the per-session discovered suppression cache too: a stopped
      // reconciler is being torn down (scope/identity change) or paused across
      // a prerequisite loss, after which every container must be re-validated.
      state.discoveredContainerIds.clear();
      // Drop pending self-echo originations too — they are session-scoped and a
      // teardown invalidates them.
      clearOriginatedDocuments(host.domainScope);
    },
  };
}

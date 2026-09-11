import {
  getOrCreateDomainSyncCoordinator,
  type SyncLane,
} from "../../data/sync/syncCoordinator";
import {
  acknowledgeContainerForce,
  activateContainer,
  enqueueKnownContainersForIdleBackfill,
  type IdleBackfillState,
  markContainerForced,
} from "./idleBackfill";
import { createInitialDocumentProbe } from "./initialDocumentProbe";
import {
  isCurrentReconciliationLifecycle,
  reconcileMarkedContainer,
  sweepKnownContainers,
} from "./knownContainerSweep";
import { rearmFailedContainer } from "./laneFailure";
import { clearOriginatedDocuments } from "./originatedDocuments";
import { createReconcileQueue, type ReconcilePriority } from "./queue";
import type {
  ReconciliationHost,
  ReconciliationRuntimeStatus,
  ReconciliationService,
} from "./serviceTypes";

function canReconcile(status: ReconciliationRuntimeStatus): boolean {
  return status.dbStatus === "ready" && status.isAuthenticated && status.online;
}

type RefreshScope = "root" | "full";

interface ReconciliationState extends IdleBackfillState {
  active: boolean;
  lane: SyncLane | null;
  lifecycleGeneration: number;
  probeContinuationCancel: (() => void) | null;
  pendingRefresh: {
    readonly promise: Promise<void>;
    readonly scope: RefreshScope;
  } | null;
}

async function runReconcileLane(
  host: ReconciliationHost,
  state: ReconciliationState,
): Promise<void> {
  if (!state.active || !canReconcile(host.getRuntimeStatus())) {
    return;
  }
  const lifecycleGeneration = state.lifecycleGeneration;

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
  const forceGeneration = state.forcedContainerGenerations.get(containerId);
  const shouldForce = forceGeneration !== undefined;
  if (shouldForce || !state.discoveredContainerIds.has(containerId)) {
    state.discoveredContainerIds.add(containerId);
    try {
      const reconciled = await reconcileMarkedContainer(
        host,
        state,
        containerId,
        shouldForce,
      );
      if (reconciled) {
        acknowledgeContainerForce(state, containerId, forceGeneration);
      }
    } catch (error) {
      rearmFailedContainer(
        state,
        containerId,
        forceGeneration,
        lifecycleGeneration,
      );
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
  state.probeContinuationCancel?.();
  const canContinue = () =>
    state.active &&
    state.queue.size === 0 &&
    canReconcile(host.getRuntimeStatus()) &&
    state.initialDocumentProbe.hasPendingWork();
  if (!canContinue()) {
    state.probeContinuationCancel = null;
    return;
  }
  const timeout = setTimeout(() => {
    if (canContinue()) {
      state.probeContinuationCancel = null;
      state.lane?.requestSync();
    }
  }, state.initialDocumentProbe.continuationDelayMs());
  state.probeContinuationCancel = () => clearTimeout(timeout);
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

async function refreshAndReconcileContainers(input: {
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
  const lifecycleGeneration = state.lifecycleGeneration;

  if (input.forceAllDocumentContentPulls) {
    state.queue.clear();
  }
  try {
    // A resync_required structural refresh runs independently of this service.
    // If it already removed a container after the forced document lane won its
    // race against the old tree, forget the stale discovered bit before this
    // refresh can re-add the same id.
    forgetIneligibleDiscoveredContainers(host, state);
    await refreshTree();
    if (!isCurrentReconciliationLifecycle(state, lifecycleGeneration)) {
      return;
    }
    // Structural hydration can revoke and remove a container after a targeted
    // force already reconciled it against the old tree. Forget every id that
    // is no longer remotely listable so a later share of the same container id
    // is treated as newly surfaced instead of being suppressed for the rest of
    // the session.
    forgetIneligibleDiscoveredContainers(host, state);
    await sweepKnownContainers({
      forceAllDocumentContentPulls: input.forceAllDocumentContentPulls,
      host,
      knownIds: listContainerIds(),
      lifecycleGeneration,
      state,
    });
    if (!isCurrentReconciliationLifecycle(state, lifecycleGeneration)) {
      return;
    }
  } catch (error) {
    if (!isCurrentReconciliationLifecycle(state, lifecycleGeneration)) {
      return;
    }
    if (!host.isIgnorableError(error)) {
      throw error;
    }
  }
}

// Sweeps share the queue and discovered set, so they must run serially.
// Root requests join either kind of sweep; a full request after a root sweep
// must wait for it and then refresh the whole tree.
function requestContainerRefresh(input: {
  host: ReconciliationHost;
  state: ReconciliationState;
  refreshTree: () => Promise<void>;
  listContainerIds: () => ReadonlyArray<string>;
  scope: RefreshScope;
}): Promise<void> {
  const { state, scope } = input;
  const pending = state.pendingRefresh;
  if (pending && (scope === "root" || pending.scope === "full")) {
    return pending.promise;
  }

  const promise = (pending?.promise ?? Promise.resolve())
    // A failed root sweep must not prevent the queued full refresh.
    .catch(() => undefined)
    .then(() =>
      refreshAndReconcileContainers({
        forceAllDocumentContentPulls: scope === "full",
        host: input.host,
        listContainerIds: input.listContainerIds,
        refreshTree: input.refreshTree,
        state,
      }),
    )
    .finally(() => {
      if (state.pendingRefresh?.promise === promise) {
        state.pendingRefresh = null;
      }
    });
  state.pendingRefresh = { promise, scope };
  return promise;
}

function listFullRefreshContainerIds(
  host: ReconciliationHost,
  state: ReconciliationState,
): ReadonlyArray<string> {
  const knownIds = host.listKnownContainerIds();
  const activeContainerId = state.activeContainerId;
  if (
    !activeContainerId ||
    knownIds.includes(activeContainerId) ||
    !host.canDiscoverContainerDocuments(activeContainerId)
  ) {
    return knownIds;
  }
  // Explicit refresh also retries an open foreign system container that the
  // background discovery list excludes.
  return [...knownIds, activeContainerId];
}

function startReconciliationLane(
  host: ReconciliationHost,
  state: ReconciliationState,
): void {
  if (state.active) {
    return;
  }
  state.lifecycleGeneration += 1;
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
      // Fixed literal: no container or document id may reach a report. The
      // mapped stack identifies which lane body threw. Returning the host's
      // result hands a rejection to the lane reporter's wrapper; discarding it
      // would surface as an unhandled rejection instead.
      reportUnexpectedError: (error) =>
        host.logError?.("Reconciliation: sync lane failed", error),
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
    automaticRetryGenerations: new Map(),
    discoveredContainerIds: new Set(),
    forcedContainerGenerations: new Map(),
    initialDocumentProbe: createInitialDocumentProbe(host),
    lane: null,
    lifecycleGeneration: 0,
    nextForceGeneration: 0,
    probeContinuationCancel: null,
    queue: createReconcileQueue(),
    pendingRefresh: null,
    unscopedInvalidationActive: false,
    unscopedInvalidatedContainerIds: new Set(),
  };
}

function stopReconciliationService(
  host: ReconciliationHost,
  state: ReconciliationState,
): void {
  state.active = false;
  state.probeContinuationCancel?.();
  state.probeContinuationCancel = null;
  state.queue.clear();
  state.automaticRetryGenerations.clear();
  state.forcedContainerGenerations.clear();
  state.pendingRefresh = null;
  state.initialDocumentProbe.resetPending();
  // Drop the per-session discovered suppression cache too: a stopped
  // reconciler is being torn down (scope/identity change) or paused across
  // a prerequisite loss, after which every container must be re-validated.
  state.discoveredContainerIds.clear();
  state.unscopedInvalidationActive = false;
  state.unscopedInvalidatedContainerIds.clear();
  // Drop pending self-echo originations too — they are session-scoped and a
  // teardown invalidates them.
  clearOriginatedDocuments(host.domainScope);
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
    state.probeContinuationCancel?.();
    state.probeContinuationCancel = null;
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
      markContainerForced(state, containerId);
    }
    state.queue.enqueue(containerId, priority);
    scheduleDrain();
  };

  const enqueueIdleBackfill = (force = false) => {
    enqueueKnownContainersForIdleBackfill({
      force,
      host,
      scheduleDrain,
      state,
    });
  };

  return {
    start: () => {
      startReconciliationLane(host, state);
      scheduleDrain();
    },
    // Reconcile the active container first; siblings remain lazy until visited.
    setActiveContainer: (containerId) =>
      activateContainer(state, containerId, (activeId, force) =>
        enqueueContainer(activeId, "active", force),
      ),
    enqueueContainer,
    enqueueIdleBackfill,
    flushPendingUnscopedInvalidation: () => {
      if (state.unscopedInvalidationActive) {
        enqueueIdleBackfill();
      }
    },
    resetDiscovered: () => {
      state.discoveredContainerIds.clear();
      state.initialDocumentProbe.resetSkippedListings();
    },
    reconcileRootContainersNow: () =>
      requestContainerRefresh({
        host,
        state,
        refreshTree: host.refreshRootTree,
        listContainerIds: host.listAutomaticRootCatchupContainerIds,
        scope: "root",
      }),
    reconcileNow: () =>
      requestContainerRefresh({
        host,
        state,
        refreshTree: host.refreshTree,
        listContainerIds: () => listFullRefreshContainerIds(host, state),
        scope: "full",
      }),
    stop: () => stopReconciliationService(host, state),
  };
}

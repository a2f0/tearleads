import { clearOriginatedDocuments } from "../../data/sync/originatedDocuments";
import {
  requestAcknowledgedConnectionSweep,
  requestFullRefresh,
  requestRootRefresh,
} from "./containerRefresh";
import {
  acknowledgeContainerForce,
  activateContainer,
  enqueueKnownContainersForIdleBackfill,
  markContainerForced,
} from "./idleBackfill";
import { createInitialDocumentProbe } from "./initialDocumentProbe";
import {
  clearPendingDiscoveryRetries,
  isCurrentReconciliationLifecycle,
  reconcileMarkedContainers,
} from "./knownContainerSweep";
import { rearmFailedContainer } from "./laneFailure";
import { resumeOwedDocumentDiscovery } from "./owedDiscovery";
import { createReconcileQueue, type ReconcilePriority } from "./queue";
import { canReconcile, type ReconciliationState } from "./serviceState";
import type { ReconciliationHost, ReconciliationService } from "./serviceTypes";

/**
 * Queued containers one lane run lists together. Each still verifies and
 * applies on its own; the bound keeps one run's head verification well
 * inside the lane watchdog.
 */
const RECONCILE_LANE_BATCH_SIZE = 4;

function dequeueContainerBatch(state: ReconciliationState): string[] {
  const containerIds: string[] = [];
  while (containerIds.length < RECONCILE_LANE_BATCH_SIZE) {
    const containerId = state.queue.dequeue();
    if (!containerId) break;
    containerIds.push(containerId);
  }
  return containerIds;
}

async function runReconcileLane(
  host: ReconciliationHost,
  state: ReconciliationState,
): Promise<void> {
  if (!state.active || !canReconcile(host.getRuntimeStatus())) {
    return;
  }
  const lifecycleGeneration = state.lifecycleGeneration;

  const containerIds = dequeueContainerBatch(state);
  if (containerIds.length === 0) {
    await state.initialDocumentProbe.run();
    scheduleProbeContinuation(host, state);
    return;
  }
  // Double-check at run time: a container may have been discovered (by an
  // explicit refresh or an earlier lane pass) after it was queued. Mark it
  // discovered up front to collapse concurrent re-enqueues into one fetch, but
  // roll the mark back on failure so a transient error can be retried. Force
  // generations are read before the batched listing starts.
  const batch = containerIds.flatMap((containerId) => {
    const forceGeneration = state.forcedContainerGenerations.get(containerId);
    if (
      forceGeneration === undefined &&
      state.discoveredContainerIds.has(containerId)
    ) {
      return [];
    }
    state.discoveredContainerIds.add(containerId);
    return [{ containerId, forceGeneration }];
  });
  const results = await reconcileMarkedContainers(
    host,
    state,
    batch.map(({ containerId, forceGeneration }) => ({
      containerId,
      forceDocumentContentPull: forceGeneration !== undefined,
    })),
  );
  let firstError: unknown;
  results.forEach((result, index) => {
    const forceGeneration = batch[index]?.forceGeneration;
    if (result.status === "reconciled") {
      acknowledgeContainerForce(state, result.containerId, forceGeneration);
    } else if (result.status === "failed") {
      rearmFailedContainer(
        state,
        result.containerId,
        forceGeneration,
        lifecycleGeneration,
      );
      firstError ??= result.error;
    }
  });
  if (firstError !== undefined) throw firstError;

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
  state.probeContinuationCancel = host.clock.schedule(() => {
    if (canContinue()) {
      state.probeContinuationCancel = null;
      state.lane?.requestSync();
    }
  }, state.initialDocumentProbe.continuationDelayMs());
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
  state.lane = host.registerLane("reconciliation:documents", {
    label: "Device-first document reconciliation",
    // Document discovery runs in the document phase, after structural
    // container hydration/metadata sync settles for the scope.
    phase: "document",
    priority: () => (state.activeContainerId ? -1 : 0),
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
  });
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
    forcedDocumentIds: new Map(),
    initialDocumentProbe: createInitialDocumentProbe(host),
    lane: null,
    lifecycleGeneration: 0,
    nextForceGeneration: 0,
    probeContinuationCancel: null,
    queue: createReconcileQueue(),
    pendingRefresh: null,
  };
}

function stopReconciliationService(
  host: ReconciliationHost,
  state: ReconciliationState,
): void {
  clearPendingDiscoveryRetries(state);
  state.active = false;
  state.probeContinuationCancel?.();
  state.probeContinuationCancel = null;
  state.queue.clear();
  state.automaticRetryGenerations.clear();
  state.forcedContainerGenerations.clear();
  state.forcedDocumentIds.clear();
  state.pendingRefresh = null;
  state.initialDocumentProbe.resetPending();
  // Drop the per-session discovered suppression cache too: a stopped
  // reconciler is being torn down (scope/identity change) or paused across
  // a prerequisite loss, after which every container must be re-validated.
  state.discoveredContainerIds.clear();
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
    documentId?: string,
  ) => {
    if (!containerId) {
      return;
    }
    // Skip containers already reconciled this session unless forced. Events
    // force re-discovery; passive active/backfill scheduling does not, so
    // opening Explorer does not re-fetch every container on each navigation.
    if (
      !force &&
      !state.forcedContainerGenerations.has(containerId) &&
      state.discoveredContainerIds.has(containerId)
    ) {
      return;
    }
    if (force) {
      markContainerForced(state, containerId, documentId);
    }
    state.queue.enqueue(containerId, priority);
    scheduleDrain();
  };

  const enqueueIdleBackfill = () => {
    enqueueKnownContainersForIdleBackfill({
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
      activateContainer(state, containerId, (activeId) =>
        enqueueContainer(activeId, "active"),
      ),
    enqueueContainer,
    enqueueIdleBackfill,
    resumeOwedDiscovery: () => {
      const generation = state.lifecycleGeneration;
      resumeOwedDocumentDiscovery({
        enqueue: enqueueContainer,
        host,
        isCurrent: () => isCurrentReconciliationLifecycle(state, generation),
      });
    },
    resetDiscovered: () => {
      state.discoveredContainerIds.clear();
      state.initialDocumentProbe.resetSkippedListings();
    },
    reconcileRootContainersNow: (options) =>
      requestRootRefresh(host, state, options),
    reconcileNow: (options) => requestFullRefresh(host, state, options),
    reconcileAcknowledgedConnection: () =>
      requestAcknowledgedConnectionSweep(host, state),
    stop: () => stopReconciliationService(host, state),
  };
}

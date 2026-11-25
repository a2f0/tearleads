import {
  isCurrentReconciliationLifecycle,
  sweepKnownContainers,
} from "./knownContainerSweep";
import { SWEEP_RETRY_BACKOFF_MS } from "./laneFailure";
import type { ReconcilePriority } from "./queue";
import { canReconcile, type ReconciliationState } from "./serviceState";
import type { ReconciliationHost } from "./serviceTypes";
import {
  type RefreshScope,
  refreshTreeForSweep,
  SharedRefresh,
} from "./sharedRefresh";

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

/** Sweeps the known containers as `scope` asks; see `RefreshScope`. */
async function sweepForScope(input: {
  host: ReconciliationHost;
  knownIds: ReadonlyArray<string>;
  lifecycleGeneration: number;
  onListed: (containerId: string) => void;
  scope: RefreshScope;
  state: ReconciliationState;
  stop: AbortSignal;
}): Promise<void> {
  const { host, lifecycleGeneration, scope, state } = input;
  try {
    await sweepKnownContainers({
      forceAllDocumentContentPulls: scope === "full",
      host,
      knownIds: input.knownIds,
      lifecycleGeneration,
      listsEveryContainer: scope !== "root",
      onListed: input.onListed,
      probeUnlistedLanes: scope === "acknowledged",
      state,
      stop: input.stop,
    });
  } finally {
    // Whatever the lanes it listed owed is owed even if another lane failed.
    if (
      scope === "acknowledged" &&
      isCurrentReconciliationLifecycle(state, lifecycleGeneration)
    ) {
      try {
        await host.requestOwedDocumentReads?.();
      } catch (error) {
        // Never replace the sweep's own failure; each store also reads its
        // document's debt when its record loads and before each pull.
        host.logError?.("Reconciliation: owed document reads failed", error);
      }
    }
  }
}

async function refreshAndReconcileContainers(input: {
  host: ReconciliationHost;
  listContainerIds: () => ReadonlyArray<string>;
  refreshTree: () => Promise<void>;
  scope: RefreshScope;
  state: ReconciliationState;
  /** Every caller withdrew: stop at the next safe boundary. */
  stop: AbortSignal;
}): Promise<void> {
  const { host, listContainerIds, refreshTree, scope, state, stop } = input;
  if (!canReconcile(host.getRuntimeStatus())) {
    return;
  }
  const lifecycleGeneration = state.lifecycleGeneration;

  // A sweep that lists every known container takes over the queue, so each
  // container is fetched once. It hands back whatever it leaves unsettled,
  // so queued work is never dropped.
  const takenOver = scope === "root" ? [] : state.queue.drain();
  const listedBySweep = new Set<string>();
  try {
    // A resync_required structural refresh runs independently of this service.
    // If it already removed a container after the forced document lane won its
    // race against the old tree, forget the stale discovered bit before this
    // refresh can re-add the same id.
    forgetIneligibleDiscoveredContainers(host, state);
    // A tree refresh that failed still leaves every known container to
    // reconcile: sweep them, then report the tree failure.
    const treeError = await refreshTreeForSweep(host, refreshTree, stop);
    if (
      !isCurrentReconciliationLifecycle(state, lifecycleGeneration) ||
      stop.aborted
    ) {
      return;
    }
    // Structural hydration can revoke and remove a container after a targeted
    // force already reconciled it against the old tree. Forget every id that
    // is no longer remotely listable so a later share of the same container id
    // is treated as newly surfaced instead of being suppressed for the rest of
    // the session.
    forgetIneligibleDiscoveredContainers(host, state);
    await sweepForScope({
      host,
      knownIds: listContainerIds(),
      lifecycleGeneration,
      onListed: (containerId) => listedBySweep.add(containerId),
      scope,
      state,
      stop,
    });
    if (
      !isCurrentReconciliationLifecycle(state, lifecycleGeneration) ||
      stop.aborted
    ) {
      return;
    }
    if (treeError !== undefined) throw treeError;
  } catch (error) {
    if (!isCurrentReconciliationLifecycle(state, lifecycleGeneration)) {
      return;
    }
    if (!host.isIgnorableError(error)) {
      throw error;
    }
  } finally {
    // A lane the sweep listed is settled even when the listing held nothing
    // new, which leaves it undiscovered: listing it again would repeat the
    // same request.
    requeueUnsettledContainers(
      state,
      takenOver.filter(
        ([containerId]) =>
          state.forcedContainerGenerations.has(containerId) ||
          !listedBySweep.has(containerId),
      ),
      lifecycleGeneration,
    );
  }
}

/**
 * Re-queues the containers a full sweep took over but did not settle: one it
 * never reached, one outside the known set, a failure, or a force it did not
 * acknowledge. A container it settled is discovered with no force left, which
 * the lane would only skip. The lane picks them up after the sweep's retry
 * backoff, so a container that just failed is not retried at once.
 */
function requeueUnsettledContainers(
  state: ReconciliationState,
  entries: ReadonlyArray<readonly [string, ReconcilePriority]>,
  lifecycleGeneration: number,
): void {
  if (
    entries.length === 0 ||
    !isCurrentReconciliationLifecycle(state, lifecycleGeneration)
  ) {
    return;
  }
  for (const [containerId, priority] of entries) {
    if (
      state.forcedContainerGenerations.has(containerId) ||
      !state.discoveredContainerIds.has(containerId)
    ) {
      state.queue.enqueue(containerId, priority);
    }
  }
  if (state.queue.size > 0) {
    state.lane?.requestSyncAfter(SWEEP_RETRY_BACKOFF_MS);
  }
}

// Sweeps share the queue and discovered set, so they must run serially.
// A request joins a sweep of its own scope or a full one, which does all a
// narrower sweep does. No other pair joins: an acknowledged sweep lists no
// tree lane, so a root request that joined it would skip its root listing,
// and a full request after a narrower sweep must wait for it and then
// refresh the whole tree. A fresh-listing request
// joins only a sweep that has not started: one already running may have listed
// before the event behind the request, so it queues a trailing sweep instead.
// A sweep every caller withdrew from is stopping, so nothing joins it.
export function requestContainerRefresh(input: {
  freshListing: boolean;
  host: ReconciliationHost;
  state: ReconciliationState;
  refreshTree: () => Promise<void>;
  listContainerIds: () => ReadonlyArray<string>;
  scope: RefreshScope;
  signal: AbortSignal | undefined;
}): Promise<void> {
  const { state, scope, signal } = input;
  if (signal?.aborted) return Promise.reject(signal.reason);
  const pending = state.pendingRefresh;
  if (
    pending &&
    !pending.stopping &&
    (pending.scope === "full" || pending.scope === scope) &&
    !(input.freshListing && pending.started)
  ) {
    return pending.join(signal);
  }

  const refresh = new SharedRefresh({
    after: pending?.promise,
    onSettled: (settled) => {
      if (state.pendingRefresh === settled) state.pendingRefresh = null;
    },
    run: (stop) =>
      refreshAndReconcileContainers({
        host: input.host,
        listContainerIds: input.listContainerIds,
        refreshTree: input.refreshTree,
        scope,
        state,
        stop,
      }),
    scope,
  });
  state.pendingRefresh = refresh;
  return refresh.join(signal);
}

// The container store re-lists the tree itself on the acknowledgement, so
// this sweep lists document lanes only. It never joins a sweep that already
// started: that one may have listed before the acknowledgement.
export function requestAcknowledgedConnectionSweep(
  host: ReconciliationHost,
  state: ReconciliationState,
): Promise<void> {
  const sweep = requestContainerRefresh({
    freshListing: true,
    host,
    state,
    refreshTree: () => Promise.resolve(),
    listContainerIds: () => listFullRefreshContainerIds(host, state),
    scope: "acknowledged",
    signal: undefined,
  });
  // Nothing awaits the sweep an acknowledgement starts, so report its
  // failure here. An ignorable one never reaches this promise.
  sweep.catch((error: unknown) =>
    host.logError?.("Reconciliation: connection catch-up failed", error),
  );
  return sweep;
}

export function listFullRefreshContainerIds(
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

import { defersRootSweepLane } from "./catchUpMachine";
import {
  isCurrentReconciliationLifecycle,
  sweepKnownContainers,
} from "./knownContainerSweep";
import { SWEEP_RETRY_BACKOFF_MS } from "./laneFailure";
import type { ReconcilePriority } from "./queue";
import { canReconcile, type ReconciliationState } from "./serviceState";
import type { ReconciliationHost, RefreshRequestOptions } from "./serviceTypes";
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

/**
 * Whether `scope` lists lanes from their watermarks and forces nothing: a
 * listed document behind this device's cursor is owed its read by the
 * listing itself, and a lane that cannot be listed has its documents probed.
 */
function listsLanesUnforced(scope: RefreshScope): boolean {
  return scope === "acknowledged";
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
      probeUnlistedLanes: listsLanesUnforced(scope),
      state,
      stop: input.stop,
    });
  } finally {
    // Whatever the lanes it listed owed is owed even if another lane failed.
    if (
      listsLanesUnforced(scope) &&
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

/** What one sweep lists, read once the sweep is running. */
export interface SweepPlan {
  /** The containers whose document lanes the sweep lists. */
  readonly containerIds: ReadonlyArray<string>;
  /**
   * Known containers a complete tree crawl vouches for without a listing:
   * no tree listing was served their row and no record owes their lane, so
   * their lane did not move. They count as reconciled this session, and an
   * unforced queue entry for one is settled.
   */
  readonly vouchedContainerIds?: ReadonlyArray<string> | undefined;
}

type PlanSweep = () => SweepPlan | Promise<SweepPlan>;

/**
 * Reads the sweep's plan and returns the containers to list. A container the
 * plan vouches for counts as reconciled this session and is added to
 * `settled`, so an unforced queue entry for it is not listed.
 */
async function readSweepPlan(
  input: { planSweep: PlanSweep; state: ReconciliationState },
  settled: Set<string>,
): Promise<ReadonlyArray<string>> {
  const { state } = input;
  // Reading the plan can outlast the session: a stop and start meanwhile
  // gives the discovered set to a new one, which this sweep must not touch.
  const lifecycleGeneration = state.lifecycleGeneration;
  const plan = await input.planSweep();
  if (!isCurrentReconciliationLifecycle(state, lifecycleGeneration)) return [];
  for (const containerId of plan.vouchedContainerIds ?? []) {
    state.discoveredContainerIds.add(containerId);
    settled.add(containerId);
  }
  return plan.containerIds;
}

async function refreshAndReconcileContainers(input: {
  host: ReconciliationHost;
  planSweep: PlanSweep;
  refreshTree: () => Promise<void>;
  scope: RefreshScope;
  state: ReconciliationState;
  /** Every caller withdrew: stop at the next safe boundary. */
  stop: AbortSignal;
}): Promise<void> {
  const { host, refreshTree, scope, state, stop } = input;
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
    const knownIds = await readSweepPlan(input, listedBySweep);
    if (
      !isCurrentReconciliationLifecycle(state, lifecycleGeneration) ||
      stop.aborted
    ) {
      return;
    }
    await sweepForScope({
      host,
      knownIds,
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

/**
 * Whether a request of `scope` may join the `pending` sweep. A request joins
 * a sweep of its own scope or a full one, which does all a narrower sweep
 * does. No other pair joins: an acknowledged sweep lists no tree lane, so a
 * root request that joined one would skip its root listing, and a full
 * request after a narrower sweep must wait for it and then refresh the whole
 * tree.
 *
 * A fresh-listing request joins only a sweep that has not started: one
 * already running may have listed before the event behind the request, so it
 * queues a trailing sweep instead. A sweep every caller withdrew from is
 * stopping, so nothing joins it.
 */
function joinsPendingRefresh(
  pending: SharedRefresh,
  scope: RefreshScope,
  freshListing: boolean,
): boolean {
  if (pending.stopping) return false;
  return (
    (pending.scope === "full" || pending.scope === scope) &&
    !(freshListing && pending.started)
  );
}

// Sweeps share the queue and discovered set, so they must run serially.
export function requestContainerRefresh(input: {
  freshListing: boolean;
  host: ReconciliationHost;
  state: ReconciliationState;
  refreshTree: () => Promise<void>;
  planSweep: PlanSweep;
  scope: RefreshScope;
  signal: AbortSignal | undefined;
}): Promise<void> {
  const { state, scope, signal } = input;
  if (signal?.aborted) return Promise.reject(signal.reason);
  const pending = state.pendingRefresh;
  if (pending && joinsPendingRefresh(pending, scope, input.freshListing)) {
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
        planSweep: input.planSweep,
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

/** Re-lists root containers, then reconciles the root catch-up set. */
export function requestRootRefresh(
  host: ReconciliationHost,
  state: ReconciliationState,
  options: RefreshRequestOptions | undefined,
): Promise<void> {
  return requestContainerRefresh({
    freshListing: options?.freshListing === true,
    host,
    state,
    refreshTree: host.refreshRootTree,
    // A catch-up waiting on its crawl will list or vouch for each lane it
    // knew at the acknowledgement; a hint's forced lane is listed now.
    planSweep: () => ({
      containerIds: host
        .listAutomaticRootCatchupContainerIds()
        .filter(
          (containerId) =>
            state.forcedContainerGenerations.has(containerId) ||
            !defersRootSweepLane(state.catchUp, containerId),
        ),
    }),
    scope: "root",
    signal: options?.signal,
  });
}

/** Refreshes the whole tree, then reconciles every known container. */
export function requestFullRefresh(
  host: ReconciliationHost,
  state: ReconciliationState,
  options: RefreshRequestOptions | undefined,
): Promise<void> {
  return requestContainerRefresh({
    freshListing: options?.freshListing === true,
    host,
    state,
    refreshTree: host.refreshTree,
    planSweep: () => ({
      containerIds: listFullRefreshContainerIds(host, state),
    }),
    scope: "full",
    signal: options?.signal,
  });
}

export function listFullRefreshContainerIds(
  host: ReconciliationHost,
  state: ReconciliationState,
): ReadonlyArray<string> {
  return withOpenContainer(host, state, host.listKnownContainerIds());
}

/** `knownIds`, and the open container when the reconciler can list it. */
export function withOpenContainer(
  host: ReconciliationHost,
  state: ReconciliationState,
  knownIds: ReadonlyArray<string>,
): ReadonlyArray<string> {
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

import {
  requestContainerRefresh,
  type SweepPlan,
  withOpenContainer,
} from "./containerRefresh";
import { isCurrentReconciliationLifecycle } from "./knownContainerSweep";
import type { ReconcilePriority } from "./queue";
import { canReconcile, type ReconciliationState } from "./serviceState";
import type { ReconciliationHost } from "./serviceTypes";
import {
  DEFAULT_UNACKNOWLEDGED_CATCH_UP_INTERVAL_MS,
  transitionUnacknowledgedCatchUp,
  type UnacknowledgedCatchUpEvent,
} from "./unacknowledgedCatchUpMachine";

function isAcknowledgedControlActive(
  host: ReconciliationHost,
  state: ReconciliationState,
): boolean {
  return (
    state.catchUp.status !== "idle" ||
    state.pendingRefresh?.scope === "acknowledged" ||
    host.getRuntimeStatus().serverEventsConnected === true
  );
}

function isUnacknowledgedCatchUpEligible(
  host: ReconciliationHost,
  state: ReconciliationState,
): boolean {
  if (!state.active || !host.crawlTreeForCatchUp) return false;
  if (!state.unacknowledgedPollingArmed) return false;
  if (isAcknowledgedControlActive(host, state)) return false;
  const status = host.getRuntimeStatus();
  // Do not cancel while a later reconnect attempt is pending: a flapping socket
  // that retries more often than the poll interval would otherwise starve
  // catch-up. Initial startup attempts stay gated via `unacknowledgedPollingArmed`.
  return canReconcile(status) && status.serverEventsConnected === false;
}

function cancelUnacknowledgedCatchUpTimer(state: ReconciliationState): void {
  state.unacknowledgedCatchUpCancel?.();
  state.unacknowledgedCatchUpCancel = null;
}

function logSafely(
  host: ReconciliationHost,
  message: string,
  error: unknown,
): void {
  void Promise.resolve()
    .then(() => host.logError?.(message, error))
    .catch(() => undefined);
}

async function planUnacknowledgedCatchUp(
  host: ReconciliationHost,
  state: ReconciliationState,
  crawlVouches: boolean,
): Promise<SweepPlan> {
  const reconcilable = host.listKnownContainerIds();
  const known = withOpenContainer(host, state, reconcilable);
  if (!crawlVouches) return { containerIds: known };
  let owed: ReadonlySet<string>;
  try {
    owed = new Set(
      await host.listOwedDocumentDiscoveryContainerIds(reconcilable),
    );
  } catch (error) {
    if (host.isIgnorableError(error)) throw error;
    logSafely(host, "Reconciliation: owed lanes could not be read", error);
    return { containerIds: known };
  }
  const covered = new Set(reconcilable);
  const lists = (id: string) =>
    owed.has(id) ||
    !covered.has(id) ||
    state.forcedContainerGenerations.has(id);
  return {
    containerIds: known.filter(lists),
    vouchedContainerIds: known.filter((id) => !lists(id)),
  };
}

function launchUnacknowledgedCatchUpSweep(
  host: ReconciliationHost,
  state: ReconciliationState,
  run: object,
): void {
  const generation = state.lifecycleGeneration;
  const crawlTree = host.crawlTreeForCatchUp;
  if (!crawlTree) {
    dispatchUnacknowledgedCatchUp(host, state, {
      eligible: false,
      run,
      type: "sweep-settled",
    });
    return;
  }
  let crawlVouches = false;
  void requestContainerRefresh({
    freshListing: true,
    host,
    planSweep: () => planUnacknowledgedCatchUp(host, state, crawlVouches),
    refreshTree: async () => {
      crawlVouches = await crawlTree();
    },
    scope: "unacknowledged",
    signal: undefined,
    state,
  })
    .catch((error: unknown) => {
      if (
        !isCurrentReconciliationLifecycle(state, generation) ||
        host.isIgnorableError(error)
      ) {
        return;
      }
      logSafely(host, "Reconciliation: unacknowledged catch-up failed", error);
    })
    .finally(() => {
      if (!isCurrentReconciliationLifecycle(state, generation)) return;
      dispatchUnacknowledgedCatchUp(host, state, {
        eligible: isUnacknowledgedCatchUpEligible(host, state),
        run,
        type: "sweep-settled",
      });
    })
    .catch(() => undefined);
}

function scheduleUnacknowledgedCatchUpTimer(
  host: ReconciliationHost,
  state: ReconciliationState,
): void {
  cancelUnacknowledgedCatchUpTimer(state);
  const intervalMs = Math.max(
    1,
    host.unacknowledgedCatchUpIntervalMs ??
      DEFAULT_UNACKNOWLEDGED_CATCH_UP_INTERVAL_MS,
  );
  const generation = state.lifecycleGeneration;
  state.unacknowledgedCatchUpCancel = host.clock.schedule(() => {
    state.unacknowledgedCatchUpCancel = null;
    if (!isCurrentReconciliationLifecycle(state, generation)) return;
    dispatchUnacknowledgedCatchUp(host, state, {
      eligible: isUnacknowledgedCatchUpEligible(host, state),
      run: {},
      type: "timer-fired",
    });
  }, intervalMs);
}

function dispatchUnacknowledgedCatchUp(
  host: ReconciliationHost,
  state: ReconciliationState,
  event: UnacknowledgedCatchUpEvent,
): void {
  const next = transitionUnacknowledgedCatchUp(
    state.unacknowledgedCatchUp,
    event,
  );
  state.unacknowledgedCatchUp = next.state;
  switch (next.effect) {
    case "none":
      return;
    case "cancel":
      cancelUnacknowledgedCatchUpTimer(state);
      return;
    case "schedule":
      scheduleUnacknowledgedCatchUpTimer(host, state);
      return;
    case "run":
      if (next.state.status === "running") {
        launchUnacknowledgedCatchUpSweep(host, state, next.state.run);
      }
      return;
  }
}

export function startUnacknowledgedCatchUp(
  host: ReconciliationHost,
  state: ReconciliationState,
): void {
  if (!state.active) return;
  state.unacknowledgedPollingArmed =
    host.getRuntimeStatus().serverEventsPendingConnectAttempt === undefined;
  state.unsubscribeConnectionStatus?.();
  state.unsubscribeConnectionStatus =
    host.subscribeConnectionStatus?.(() =>
      evaluateUnacknowledgedCatchUp(host, state),
    ) ?? null;
  dispatchUnacknowledgedCatchUp(host, state, {
    eligible: isUnacknowledgedCatchUpEligible(host, state),
    type: "start",
  });
}

export function armUnacknowledgedPolling(state: ReconciliationState): void {
  state.unacknowledgedPollingArmed = true;
}

export function evaluateUnacknowledgedCatchUp(
  host: ReconciliationHost,
  state: ReconciliationState,
): void {
  if (!state.active) return;
  if (
    !state.unacknowledgedPollingArmed &&
    host.getRuntimeStatus().serverEventsPendingConnectAttempt === undefined
  ) {
    state.unacknowledgedPollingArmed = true;
  }
  dispatchUnacknowledgedCatchUp(host, state, {
    eligible: isUnacknowledgedCatchUpEligible(host, state),
    type: "evaluate",
  });
}

export function stopUnacknowledgedCatchUp(state: ReconciliationState): void {
  state.unsubscribeConnectionStatus?.();
  state.unsubscribeConnectionStatus = null;
  state.unacknowledgedPollingArmed = false;
  const next = transitionUnacknowledgedCatchUp(state.unacknowledgedCatchUp, {
    type: "stop",
  });
  state.unacknowledgedCatchUp = next.state;
  cancelUnacknowledgedCatchUpTimer(state);
}

/**
 * Catches up on a start whose connection is not acknowledged.
 *
 * When the host supplies `crawlTreeForCatchUp`, runs a watermarked tree crawl
 * first so settled folders whose server row moved since the last session owe a
 * listing, then lists only owed lanes (falling back to every known lane if the
 * crawl did not complete cleanly) and wakes open stores with owed reads.
 * Without a tree-crawl hook, falls back to queueing durable owed lanes at idle
 * priority.
 */
export function resumeOwedDocumentDiscovery(input: {
  readonly enqueue: (containerId: string, priority: ReconcilePriority) => void;
  readonly host: ReconciliationHost;
  readonly isCurrent: () => boolean;
  readonly state: ReconciliationState;
}): void {
  const { enqueue, host, isCurrent, state } = input;
  if (host.crawlTreeForCatchUp) {
    if (!isCurrent()) return;
    state.unacknowledgedPollingArmed = true;
    // Prerequisite loss (unauthenticated/offline) is handled on regain by
    // `prerequisites-regained` + `connectAttemptWaitMachine`; do not latch a
    // deferred sweep here that would race post-login bootstrap or connect ack.
    if (
      isAcknowledgedControlActive(host, state) ||
      !canReconcile(host.getRuntimeStatus())
    ) {
      return;
    }
    const run = {};
    dispatchUnacknowledgedCatchUp(host, state, { run, type: "sweep-started" });
    launchUnacknowledgedCatchUpSweep(host, state, run);
    return;
  }
  void host
    .listOwedDocumentDiscoveryContainerIds(host.listKnownContainerIds())
    .then(
      (containerIds) => {
        if (!isCurrent()) return;
        for (const containerId of containerIds) enqueue(containerId, "idle");
      },
      (error: unknown) => {
        if (!isCurrent() || host.isIgnorableError(error)) return;
        logSafely(host, "Reconciliation: owed discovery lookup failed", error);
      },
    );
}

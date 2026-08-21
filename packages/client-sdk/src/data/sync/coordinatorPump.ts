import type {
  DomainSyncCoordinatorState,
  SyncLaneState,
} from "./coordinatorState";
import {
  describeSyncLaneError,
  hasPendingLaneWork,
  publishSyncCoordinatorSnapshot,
} from "./coordinatorState";
import { compareSyncLaneOrder, createSyncTimestamp } from "./syncTelemetry";

export interface SyncIdleOptions {
  intervalMs?: number;
  quietMs?: number;
  timeoutMs?: number;
}

const DEFAULT_SYNC_IDLE_INTERVAL_MS = 10;
const DEFAULT_SYNC_IDLE_QUIET_MS = 0;
const DEFAULT_SYNC_IDLE_TIMEOUT_MS = 500;
// Backoff applied only when a failed pass left its own lane re-requested, to
// keep a persistently-failing self-re-arming lane from tight-looping the pump
// and starving the event loop. A transient failure that did not re-arm waits 0.
const FAILED_LANE_REARM_BACKOFF_MS = 1000;
// The pump yields a macrotask after this many consecutive lane runs even on the
// success path, so a run of lanes that keep re-arming (a single lane re-arming
// itself, or several lanes re-arming each other) can never starve the event
// loop. Comfortably above a normal multi-lane convergence burst so steady-state
// sync pays no extra macrotask hops.
const SYNC_PUMP_MACROTASK_YIELD_INTERVAL = 16;
// Per-lane run liveness bound. The pump awaits one lane at a time, so without
// a bound a single run stuck on a local await freezes every queued lane with
// no recovery path (scheduleCoordinatorPump no-ops while the pump promise is
// alive). When a run exceeds this, the pump records a watchdog failure and
// moves on; the run is NOT cancelled — the lane stays unselectable until it
// settles, and the settle overwrites the watchdog verdict with the real
// outcome. Generous enough that only pathological runs hit it (a legitimately
// slow run that does is abandoned-but-corrected, trading strict
// structural-before-document ordering for queue liveness in that edge).
const SYNC_LANE_WATCHDOG_MS = 120_000;

type SyncLaneRunResult =
  | { status: "completed" }
  | { status: "failed"; error: unknown };

async function runSyncLane(state: SyncLaneState): Promise<SyncLaneRunResult> {
  try {
    await state.config.run();
    return { status: "completed" };
  } catch (error: unknown) {
    if (state.config.shouldIgnoreError?.(error)) {
      return { status: "completed" };
    }

    if (state.config.onUnexpectedError) {
      state.config.onUnexpectedError(error);
      return { status: "failed", error };
    }

    throw error;
  }
}

function reportUnexpectedSyncLaneError(state: SyncLaneState, error: unknown) {
  console.error(`Failed to run sync lane ${state.key}:`, error);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Requested work the pump can actually select. A lane whose abandoned run is
// still live (activeRunToken set) is requested-but-unrunnable; counting it
// would make the pump's finally reschedule a pump that selects nothing,
// re-entering finally — an event-loop-starving reschedule spin. Its
// late-settle continuation re-pumps once the token clears.
function hasRequestedLaneWork(lanes: Iterable<SyncLaneState>): boolean {
  const now = Date.now();
  for (const lane of lanes) {
    if (
      lane.pumpDriven &&
      lane.requested &&
      lane.activeRunToken === null &&
      (lane.notBeforeAtMs === null || lane.notBeforeAtMs <= now)
    ) {
      return true;
    }
  }

  return false;
}

function selectNextRequestedLane(
  lanes: Iterable<SyncLaneState>,
): SyncLaneState | null {
  let selectedLane: SyncLaneState | null = null;
  const now = Date.now();

  for (const lane of lanes) {
    if (
      !lane.pumpDriven ||
      !lane.requested ||
      (lane.notBeforeAtMs !== null && lane.notBeforeAtMs > now)
    ) {
      continue;
    }
    // A lane with a live (possibly watchdog-abandoned) run is never selected,
    // so a lane cannot run concurrently with itself; its late-settle
    // continuation re-pumps when the old run finally lands.
    if (lane.activeRunToken !== null) {
      continue;
    }

    if (!selectedLane || compareSyncLaneOrder(lane, selectedLane) < 0) {
      selectedLane = lane;
    }
  }

  return selectedLane;
}

function recordSyncLaneRunResult(
  lane: SyncLaneState,
  runResult: SyncLaneRunResult,
): void {
  lane.lastActionAt = createSyncTimestamp();
  if (runResult.status === "failed") {
    lane.errorCount += 1;
    lane.lastAction = "failed";
    lane.lastError = describeSyncLaneError(runResult.error);
    lane.lastFailedAt = lane.lastActionAt;
  } else {
    lane.lastAction = "completed";
    lane.lastCompletedAt = lane.lastActionAt;
    lane.lastError = null;
  }
}

// A watchdog-abandoned run settled after the pump moved on: release the lane,
// overwrite the transient watchdog verdict with the real outcome, and re-pump
// if work is queued (including this lane's own re-request, which selection
// held back while the old run was live).
function settleAbandonedSyncLaneRun(
  coordinatorState: DomainSyncCoordinatorState,
  lane: SyncLaneState,
  runToken: object,
  runResult: SyncLaneRunResult,
): void {
  if (lane.activeRunToken !== runToken) {
    return;
  }
  lane.activeRunToken = null;
  recordSyncLaneRunResult(lane, runResult);
  publishSyncCoordinatorSnapshot(coordinatorState);
  if (
    !coordinatorState.disposed &&
    hasRequestedLaneWork(coordinatorState.lanes.values())
  ) {
    scheduleCoordinatorPump(coordinatorState);
  }
}

async function runRequestedSyncLanes(
  coordinatorState: DomainSyncCoordinatorState,
): Promise<void> {
  let runsSinceMacrotaskYield = 0;
  while (true) {
    // Force-stop: dispose() can fire while a lane run is mid-await. Bail before
    // selecting another lane so a disposed coordinator cannot keep pumping.
    if (coordinatorState.disposed) {
      return;
    }
    const lane = selectNextRequestedLane(coordinatorState.lanes.values());
    if (!lane) {
      return;
    }

    lane.requested = false;
    lane.notBeforeAtMs = null;
    lane.running = true;
    lane.runCount += 1;
    lane.lastAction = "started";
    lane.lastActionAt = createSyncTimestamp();
    lane.lastStartedAt = lane.lastActionAt;
    const runToken = {};
    lane.activeRunToken = runToken;
    publishSyncCoordinatorSnapshot(coordinatorState);

    // Normalize the run into a result. Rejection reaches here only for lanes
    // without an onUnexpectedError handler (runSyncLane re-throws for those).
    // lane.requested is deliberately never cleared on failure: a run can arm a
    // self follow-up (requestLaneSync) before it throws, and clearing it would
    // silently drop a queued structural follow-up — breaking the
    // phase-ordering guarantee in docs/client-sync-ordering.md. The tight-loop
    // risk a re-armed failure creates is handled by the backoff below.
    const runResultPromise: Promise<SyncLaneRunResult> = runSyncLane(lane).then(
      (result) => result,
      (error: unknown) => {
        reportUnexpectedSyncLaneError(lane, error);
        return { status: "failed", error };
      },
    );

    // Watchdog: bound how long this lane may hold the serial pump. On timeout
    // the run is abandoned (not cancelled) — the lane records a transient
    // watchdog failure, stays unselectable via its run token, and the pump
    // moves on so one stuck lane costs itself rather than the whole queue.
    // Floor at 1ms: a zero/negative override would instantly abandon every
    // run, turning the escape hatch into a self-inflicted outage.
    const watchdogMs = Math.max(
      1,
      lane.config.watchdogMs ?? SYNC_LANE_WATCHDOG_MS,
    );
    let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
    const raceOutcome = await Promise.race([
      runResultPromise.then((result) => ({
        kind: "settled" as const,
        result,
      })),
      new Promise<{ kind: "timed-out" }>((resolve) => {
        watchdogTimer = setTimeout(
          () => resolve({ kind: "timed-out" }),
          watchdogMs,
        );
      }),
    ]);
    if (watchdogTimer !== null) {
      clearTimeout(watchdogTimer);
    }

    lane.running = false;
    let runResult: SyncLaneRunResult;
    if (raceOutcome.kind === "settled") {
      lane.activeRunToken = null;
      runResult = raceOutcome.result;
    } else {
      runResult = {
        status: "failed",
        error: new Error(
          `Sync lane watchdog: run exceeded ${watchdogMs}ms; continuing with other lanes`,
        ),
      };
      void runResultPromise.then((result) =>
        settleAbandonedSyncLaneRun(coordinatorState, lane, runToken, result),
      );
    }
    recordSyncLaneRunResult(lane, runResult);
    publishSyncCoordinatorSnapshot(coordinatorState);

    runsSinceMacrotaskYield += 1;

    // The re-arm backoff exists to stop a failing lane from tight-looping; a
    // watchdog-abandoned lane cannot tight-loop (its run token holds it out of
    // selection), so a timed-out run must not delay the OTHER lanes it just
    // freed the pump for.
    if (
      runResult.status === "failed" &&
      lane.requested &&
      raceOutcome.kind === "settled"
    ) {
      // A persistently failing lane that re-armed itself backs off before it can
      // run again, so it cannot tight-loop. delay() is a setTimeout (macrotask),
      // so this also yields the event loop.
      await delay(FAILED_LANE_REARM_BACKOFF_MS);
      runsSinceMacrotaskYield = 0;
    } else if (runsSinceMacrotaskYield >= SYNC_PUMP_MACROTASK_YIELD_INTERVAL) {
      // Event-loop starvation guard. The loop's only other await — runSyncLane —
      // yields a MICROTASK, not a macrotask, so a run of lanes that keep re-arming
      // would spin this while(true) forever WITHOUT reaching the macrotask/timer
      // phase, starving setTimeout-based test timeouts, waitFor polls, and the
      // idle poller. This covers BOTH a single lane re-arming ITSELF and several
      // lanes re-arming each OTHER (where no single lane's `requested` stays set):
      // yield a macrotask every SYNC_PUMP_MACROTASK_YIELD_INTERVAL runs regardless
      // of which lane was requested. selectNextRequestedLane re-sorts by phase
      // after the yield, so structural-before-document ordering is preserved, and
      // the interval keeps normal (quickly-settling) multi-lane bursts yield-free.
      await delay(0);
      runsSinceMacrotaskYield = 0;
    }
  }
}

function scheduleCoordinatorPump(coordinatorState: DomainSyncCoordinatorState) {
  if (coordinatorState.pump || coordinatorState.disposed) {
    return;
  }

  coordinatorState.pump = Promise.resolve()
    .then(() => runRequestedSyncLanes(coordinatorState))
    .finally(() => {
      coordinatorState.pump = null;
      publishSyncCoordinatorSnapshot(coordinatorState);

      if (
        !coordinatorState.disposed &&
        hasRequestedLaneWork(coordinatorState.lanes.values())
      ) {
        scheduleCoordinatorPump(coordinatorState);
      }
    });
}

function markLaneRequested(lane: SyncLaneState, requestedAt: string): void {
  lane.requested = true;
  lane.requestCount += 1;
  lane.lastAction = "requested";
  lane.lastActionAt = requestedAt;
  lane.lastRequestedAt = requestedAt;
}

export function requestLaneSync(
  coordinatorState: DomainSyncCoordinatorState,
  lane: SyncLaneState,
) {
  if (coordinatorState.disposed || !lane.pumpDriven) {
    return;
  }
  lane.notBeforeAtMs = null;
  markLaneRequested(lane, createSyncTimestamp());
  publishSyncCoordinatorSnapshot(coordinatorState);
  scheduleCoordinatorPump(coordinatorState);
}

export function requestLaneSyncAfter(
  coordinatorState: DomainSyncCoordinatorState,
  lane: SyncLaneState,
  delayMs: number,
): void {
  if (coordinatorState.disposed || !lane.pumpDriven) {
    return;
  }
  if (lane.requested && lane.notBeforeAtMs === null) {
    return;
  }
  const requestedAtMs = Date.now() + Math.max(0, delayMs);
  lane.notBeforeAtMs =
    lane.notBeforeAtMs === null
      ? requestedAtMs
      : Math.min(lane.notBeforeAtMs, requestedAtMs);
  markLaneRequested(lane, createSyncTimestamp());
  publishSyncCoordinatorSnapshot(coordinatorState);
  const scheduledAtMs = lane.notBeforeAtMs;
  setTimeout(
    () => {
      if (coordinatorState.disposed || lane.notBeforeAtMs !== scheduledAtMs) {
        return;
      }
      lane.notBeforeAtMs = null;
      publishSyncCoordinatorSnapshot(coordinatorState);
      scheduleCoordinatorPump(coordinatorState);
    },
    Math.max(0, scheduledAtMs - Date.now()),
  );
}

export function requestAllPumpDrivenLanes(
  coordinatorState: DomainSyncCoordinatorState,
): void {
  if (coordinatorState.disposed || coordinatorState.lanes.size === 0) {
    return;
  }

  // Mark every executable lane requested, then publish the snapshot and
  // schedule the pump ONCE. Blob upload lanes are observational: requesting
  // their no-op runner would fabricate completion without uploading bytes.
  const requestedAt = createSyncTimestamp();
  let didRequestLane = false;
  for (const lane of coordinatorState.lanes.values()) {
    if (!lane.pumpDriven) {
      continue;
    }
    lane.notBeforeAtMs = null;
    markLaneRequested(lane, requestedAt);
    didRequestLane = true;
  }
  if (!didRequestLane) {
    return;
  }

  publishSyncCoordinatorSnapshot(coordinatorState);
  scheduleCoordinatorPump(coordinatorState);
}

export async function waitForIdleLanes(
  coordinatorState: DomainSyncCoordinatorState,
  options: SyncIdleOptions = {},
): Promise<boolean> {
  const intervalMs = options.intervalMs ?? DEFAULT_SYNC_IDLE_INTERVAL_MS;
  const quietMs = options.quietMs ?? DEFAULT_SYNC_IDLE_QUIET_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_SYNC_IDLE_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  let quietStartedAt = Date.now();

  while (Date.now() <= deadline) {
    if (
      !coordinatorState.pump &&
      !hasPendingLaneWork(coordinatorState.lanes.values())
    ) {
      if (Date.now() - quietStartedAt >= quietMs) {
        return true;
      }
    } else {
      quietStartedAt = Date.now();
    }

    await delay(intervalMs);
  }

  return false;
}

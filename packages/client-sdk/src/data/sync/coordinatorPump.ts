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
// Slow down repeated failures and yield periodically during successful bursts
// so lanes that keep requesting work cannot starve timers or other tasks.
const FAILED_LANE_REARM_BACKOFF_MS = 1000;
const SYNC_PUMP_MACROTASK_YIELD_INTERVAL = 16;
// A timed-out run keeps its lane occupied until it settles, but releases the
// serial pump so other lanes can proceed.
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

// An abandoned run still owns its lane. Its eventual settlement will restart
// the pump; trying to restart earlier would spin without runnable work.
function isRequestedLaneAvailable(lane: SyncLaneState): boolean {
  return lane.pumpDriven && lane.requested && lane.activeRunToken === null;
}

function hasRequestedLaneWork(lanes: Iterable<SyncLaneState>): boolean {
  const now = Date.now();
  for (const lane of lanes) {
    if (
      isRequestedLaneAvailable(lane) &&
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
      !isRequestedLaneAvailable(lane) ||
      (lane.notBeforeAtMs !== null && lane.notBeforeAtMs > now)
    ) {
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

// Replace the watchdog failure with the late result, then release queued work.
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
  lane.runAbandoned = false;
  recordSyncLaneRunResult(lane, runResult);
  publishSyncCoordinatorSnapshot(coordinatorState);
  if (
    !coordinatorState.disposed &&
    hasRequestedLaneWork(coordinatorState.lanes.values())
  ) {
    scheduleCoordinatorPump(coordinatorState);
  }
}

function startSyncLaneRun(
  coordinatorState: DomainSyncCoordinatorState,
  lane: SyncLaneState,
) {
  lane.requested = false;
  lane.notBeforeAtMs = null;
  lane.running = true;
  lane.runCount += 1;
  lane.lastAction = "started";
  lane.lastActionAt = createSyncTimestamp();
  lane.lastStartedAt = lane.lastActionAt;
  lane.runAbandoned = false;
  const runToken = {};
  lane.activeRunToken = runToken;
  publishSyncCoordinatorSnapshot(coordinatorState);

  // Keep follow-up requests even on failure; clearing them would lose work.
  // The fallback also catches errors thrown by the lane's error handlers.
  const runResultPromise: Promise<SyncLaneRunResult> = runSyncLane(lane).then(
    (result) => result,
    (error: unknown) => {
      reportUnexpectedSyncLaneError(lane, error);
      return { status: "failed", error };
    },
  );

  return { runToken, runResultPromise };
}

async function runRequestedSyncLanes(
  coordinatorState: DomainSyncCoordinatorState,
): Promise<void> {
  let runsSinceMacrotaskYield = 0;
  // Disposal can happen during a run. Finish it before selecting more work.
  while (!coordinatorState.disposed) {
    const lane = selectNextRequestedLane(coordinatorState.lanes.values());
    if (!lane) {
      return;
    }

    const { runToken, runResultPromise } = startSyncLaneRun(
      coordinatorState,
      lane,
    );
    // Clamp overrides to at least 1ms so every run has a chance to complete.
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
      lane.runAbandoned = true;
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

    if (
      runResult.status === "failed" &&
      lane.requested &&
      raceOutcome.kind === "settled"
    ) {
      // Timed-out runs cannot run again until they settle, so only ordinary
      // failures need backoff. Other lanes can proceed immediately on timeout.
      await delay(FAILED_LANE_REARM_BACKOFF_MS);
      runsSinceMacrotaskYield = 0;
    } else if (runsSinceMacrotaskYield >= SYNC_PUMP_MACROTASK_YIELD_INTERVAL) {
      // Awaiting resolved promises only yields microtasks. A timer also lets
      // the event loop advance when lanes keep requesting each other.
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

  // Publish all requests together. Observational upload lanes report actual
  // uploads and must never be driven through their no-op runner.
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

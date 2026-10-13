import type {
  DomainSyncCoordinatorState,
  SyncLaneState,
} from "./coordinatorState";
import {
  describeSyncLaneError,
  publishSyncCoordinatorSnapshot,
} from "./coordinatorState";
import type { SyncLaneConfig } from "./syncLaneConfig";
import { createSyncTimestamp } from "./syncTelemetry";

const SYNC_LANE_WATCHDOG_MS = 120_000;
const FAILED_LANE_REARM_BACKOFF_MS = 1000;

type SyncLaneRunResult =
  | { status: "completed" }
  | { status: "failed"; error: unknown };

// Keyed on the registered config so a discarded lane is collectable.
const lastReportedFailureByConfig = new WeakMap<SyncLaneConfig, string>();

// Local-only dedup key. describeSyncLaneError joins messages without their
// types, so the name keeps a swallowed DatabaseUnavailableError distinct from
// a plain Error carrying the same text; the cause chain keeps a re-wrapped
// failure distinct from its origin.
function describeSyncLaneFailureSignature(error: unknown): string {
  const name = error instanceof Error ? error.name : typeof error;
  return JSON.stringify([name, describeSyncLaneError(error)]);
}

// Observability only: a failing lane re-arms every FAILED_LANE_REARM_BACKOFF_MS
// for the rest of the session, and mobile WebViews are never reloaded, so an
// unrecoverable lane would report once a second. The signature is deliberately
// never cleared on a completed run: alternating success and failure would
// re-admit the same report every pass and evict the surrounding diagnostic
// trail from the host's bounded log.
function reportUnexpectedSyncLaneFailure(
  state: SyncLaneState,
  error: unknown,
): void {
  const report = state.config.reportUnexpectedError;
  if (!report) return;
  const signature = describeSyncLaneFailureSignature(error);
  if (lastReportedFailureByConfig.get(state.config) === signature) return;
  lastReportedFailureByConfig.set(state.config, signature);
  try {
    void Promise.resolve(report(error)).catch(() => undefined);
  } catch {
    // Hosts may throw synchronously or return a rejected promise.
  }
}

async function runSyncLane(state: SyncLaneState): Promise<SyncLaneRunResult> {
  try {
    await state.config.run();
    return { status: "completed" };
  } catch (error: unknown) {
    if (state.config.shouldIgnoreError?.(error)) {
      return { status: "completed" };
    }
    reportUnexpectedSyncLaneFailure(state, error);

    if (state.config.onUnexpectedError) {
      state.config.onUnexpectedError(error);
      return { status: "failed", error };
    }

    throw error;
  }
}

// Console-only on purpose. This runs only when the lane's OWN error handler
// already threw, so it must never route through reportUnexpectedSyncLaneFailure
// as well: re-entering a handler that just threw would reject runResultPromise
// from inside its own onRejected callback, leaving `running` true and
// `activeRunToken` set, which wedges the lane for the rest of the session.
function reportUnexpectedSyncLaneError(state: SyncLaneState, error: unknown) {
  console.error(`Failed to run sync lane ${state.key}:`, error);
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
  wake: () => void,
): void {
  if (lane.activeRunToken !== runToken) {
    return;
  }
  lane.activeRunToken = null;
  lane.runAbandoned = false;
  recordSyncLaneRunResult(lane, runResult);
  publishSyncCoordinatorSnapshot(coordinatorState);
  if (!coordinatorState.disposed && lane.requested) {
    wake();
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

  // Keep follow-up requests even on failure to preserve phase ordering; see
  // docs/client-sync-ordering.md.
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

export async function runCoordinatorLane(
  coordinatorState: DomainSyncCoordinatorState,
  lane: SyncLaneState,
  wake: () => void,
): Promise<void> {
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
      settleAbandonedSyncLaneRun(
        coordinatorState,
        lane,
        runToken,
        result,
        wake,
      ),
    );
  }
  recordSyncLaneRunResult(lane, runResult);
  publishSyncCoordinatorSnapshot(coordinatorState);

  if (
    runResult.status === "failed" &&
    lane.requested &&
    raceOutcome.kind === "settled"
  ) {
    // A fresh hint cannot bypass a failed lane's cooldown. Other document
    // lanes remain runnable; structural retries still preserve the barrier.
    lane.retryAtMs = Date.now() + FAILED_LANE_REARM_BACKOFF_MS;
    setTimeout(wake, FAILED_LANE_REARM_BACKOFF_MS);
  }
}

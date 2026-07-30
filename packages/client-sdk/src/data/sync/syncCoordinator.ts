import type { DomainScope } from "../domainScope";
import type {
  DomainSyncCoordinatorState,
  SyncLaneState,
} from "./coordinatorState";
import {
  describeSyncLaneError,
  hasPendingLaneWork,
  publishSyncCoordinatorSnapshot,
} from "./coordinatorState";
import type { SyncLane, SyncLaneConfig } from "./syncLaneConfig";
import type { DomainSyncSnapshot } from "./syncTelemetry";
import {
  compareSyncLaneOrder,
  createDomainSyncSnapshot,
  createSyncTimestamp,
} from "./syncTelemetry";
import type { UploadSyncLane, UploadSyncLaneOptions } from "./uploadLane";
import { beginUploadLane } from "./uploadLane";

// Re-exported here because lanes reach it as a shouldIgnoreError alongside the
// rest of the coordinator surface; it lives in data/databaseUnavailable with the
// error type it discriminates on.
export { isDatabaseUnavailableError } from "../databaseUnavailable";
export type { SyncLane, SyncLaneConfig } from "./syncLaneConfig";
export {
  didRegainSyncPrerequisites,
  type SyncRuntimeStatus,
} from "./syncPrerequisites";
export type {
  DomainSyncSnapshot,
  SyncLaneLastAction,
  SyncLanePhase,
  SyncLaneProgress,
  SyncLaneSnapshot,
  SyncLaneStatus,
} from "./syncTelemetry";
export type { UploadSyncLane, UploadSyncLaneOptions } from "./uploadLane";

export interface SyncIdleOptions {
  intervalMs?: number;
  quietMs?: number;
  timeoutMs?: number;
}

export interface DomainSyncCoordinator {
  beginUploadLane: (
    key: string,
    options?: UploadSyncLaneOptions,
  ) => UploadSyncLane;
  // Force-stop the pump, drop all queued lane work, and refuse further runs.
  dispose: () => void;
  getSnapshot: () => DomainSyncSnapshot;
  registerLane: (key: string, config: SyncLaneConfig) => SyncLane;
  // Re-request every pump-driven lane — a manual "sync now" that re-drives
  // durable owners stranded by a transient failure. Observational upload rows
  // are updated only by those owners' real attachment upload attempts.
  requestAllLanes: () => void;
  // Request one registered pump lane without re-driving unrelated owners.
  requestLane: (key: string) => void;
  hasPendingWork: () => boolean;
  subscribe: (listener: () => void) => () => void;
  waitForIdle: (options?: SyncIdleOptions) => Promise<boolean>;
}

const coordinatorsByScope = new WeakMap<DomainScope, DomainSyncCoordinator>();
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
  for (const lane of lanes) {
    if (lane.pumpDriven && lane.requested && lane.activeRunToken === null) {
      return true;
    }
  }

  return false;
}

function selectNextRequestedLane(
  lanes: Iterable<SyncLaneState>,
): SyncLaneState | null {
  let selectedLane: SyncLaneState | null = null;

  for (const lane of lanes) {
    if (!lane.pumpDriven || !lane.requested) {
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

function requestLaneSync(
  coordinatorState: DomainSyncCoordinatorState,
  lane: SyncLaneState,
) {
  if (coordinatorState.disposed || !lane.pumpDriven) {
    return;
  }
  markLaneRequested(lane, createSyncTimestamp());
  publishSyncCoordinatorSnapshot(coordinatorState);
  scheduleCoordinatorPump(coordinatorState);
}

function requestAllPumpDrivenLanes(
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
    markLaneRequested(lane, requestedAt);
    didRequestLane = true;
  }
  if (!didRequestLane) {
    return;
  }

  publishSyncCoordinatorSnapshot(coordinatorState);
  scheduleCoordinatorPump(coordinatorState);
}

async function waitForIdleLanes(
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

function createDomainSyncCoordinator(): DomainSyncCoordinator {
  const coordinatorState: DomainSyncCoordinatorState = {
    disposed: false,
    lanes: new Map<string, SyncLaneState>(),
    listeners: new Set(),
    nextRegistrationIndex: 0,
    pump: null,
    snapshot: createDomainSyncSnapshot({
      hasPendingWork: false,
      lanes: [],
      pumpActive: false,
    }),
  };

  return {
    beginUploadLane(key: string, options: UploadSyncLaneOptions = {}) {
      return beginUploadLane(coordinatorState, key, options);
    },
    dispose() {
      coordinatorState.disposed = true;
      // Drop queued work so waitForIdle reports settled immediately and a
      // lane left re-requested by an in-flight run does not survive teardown.
      for (const lane of coordinatorState.lanes.values()) {
        lane.requested = false;
      }
      // Publish the final settled snapshot, then release listener closures:
      // the coordinator is dropped from the registry and a remount subscribes
      // to a fresh one.
      publishSyncCoordinatorSnapshot(coordinatorState);
      coordinatorState.listeners.clear();
    },
    getSnapshot() {
      return coordinatorState.snapshot;
    },
    hasPendingWork() {
      return (
        !!coordinatorState.pump ||
        hasPendingLaneWork(coordinatorState.lanes.values())
      );
    },
    registerLane(key: string, config: SyncLaneConfig): SyncLane {
      const existingLane = coordinatorState.lanes.get(key);
      if (existingLane) {
        existingLane.config = config;
        existingLane.blobStorageKey = null;
        existingLane.pumpDriven = true;
        publishSyncCoordinatorSnapshot(coordinatorState);
        return {
          requestSync: () => requestLaneSync(coordinatorState, existingLane),
        };
      }

      const registeredAt = createSyncTimestamp();
      const nextLane: SyncLaneState = {
        activeRunToken: null,
        blobStorageKey: null,
        config,
        errorCount: 0,
        key,
        lastAction: "registered",
        lastActionAt: registeredAt,
        lastCompletedAt: null,
        lastError: null,
        lastFailedAt: null,
        lastRequestedAt: null,
        lastStartedAt: null,
        progress: null,
        pumpDriven: true,
        registrationIndex: coordinatorState.nextRegistrationIndex,
        requestCount: 0,
        requested: false,
        runCount: 0,
        running: false,
      };
      coordinatorState.nextRegistrationIndex += 1;
      coordinatorState.lanes.set(key, nextLane);
      publishSyncCoordinatorSnapshot(coordinatorState);
      return {
        requestSync: () => requestLaneSync(coordinatorState, nextLane),
      };
    },
    requestAllLanes() {
      requestAllPumpDrivenLanes(coordinatorState);
    },
    requestLane(key: string) {
      const lane = coordinatorState.lanes.get(key);
      if (lane?.pumpDriven) {
        requestLaneSync(coordinatorState, lane);
      }
    },
    subscribe(listener: () => void) {
      coordinatorState.listeners.add(listener);
      return () => {
        coordinatorState.listeners.delete(listener);
      };
    },
    waitForIdle(options?: SyncIdleOptions) {
      return waitForIdleLanes(coordinatorState, options);
    },
  };
}

export function getOrCreateDomainSyncCoordinator(
  domainScope: DomainScope,
): DomainSyncCoordinator {
  const existingCoordinator = coordinatorsByScope.get(domainScope);
  if (existingCoordinator) {
    return existingCoordinator;
  }

  const nextCoordinator = createDomainSyncCoordinator();
  coordinatorsByScope.set(domainScope, nextCoordinator);
  return nextCoordinator;
}

export function hasDomainSyncCoordinatorPendingWork(
  domainScope: DomainScope,
): boolean {
  return coordinatorsByScope.get(domainScope)?.hasPendingWork() ?? false;
}

// Re-request every pump-driven lane for a scope: a user-driven "sync now" that
// retries durable work stranded by a transient failure. Observational upload
// telemetry is never directly pumped. A no-op when no coordinator exists yet
// (nothing has been synced) or it has been disposed.
export function requestAllDomainSyncLanes(domainScope: DomainScope): void {
  coordinatorsByScope.get(domainScope)?.requestAllLanes();
}

export function requestDomainSyncLane(
  domainScope: DomainScope,
  key: string,
): void {
  coordinatorsByScope.get(domainScope)?.requestLane(key);
}

// Force-stop the coordinator for a scope and drop it from the registry, so a
// pump cannot outlive the runtime/React tree that created it. A later
// getOrCreate for the same scope builds a fresh coordinator.
export function disposeDomainSyncCoordinator(domainScope: DomainScope): void {
  const coordinator = coordinatorsByScope.get(domainScope);
  if (!coordinator) {
    return;
  }

  coordinator.dispose();
  coordinatorsByScope.delete(domainScope);
}

export function getDomainSyncCoordinatorSnapshot(
  domainScope: DomainScope,
): DomainSyncSnapshot {
  return getOrCreateDomainSyncCoordinator(domainScope).getSnapshot();
}

export function subscribeToDomainSyncCoordinator(
  domainScope: DomainScope,
  listener: () => void,
): () => void {
  return getOrCreateDomainSyncCoordinator(domainScope).subscribe(listener);
}

export function beginDomainSyncUploadLane(
  domainScope: DomainScope,
  key: string,
  options?: UploadSyncLaneOptions,
): UploadSyncLane {
  return getOrCreateDomainSyncCoordinator(domainScope).beginUploadLane(
    key,
    options,
  );
}

export function waitForDomainSyncCoordinatorToSettle(
  domainScope: DomainScope,
  options?: SyncIdleOptions,
): Promise<boolean> {
  return (
    coordinatorsByScope.get(domainScope)?.waitForIdle(options) ??
    Promise.resolve(true)
  );
}

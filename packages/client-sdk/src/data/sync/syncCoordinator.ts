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
export type {
  DomainSyncSnapshot,
  SyncLaneLastAction,
  SyncLanePhase,
  SyncLaneProgress,
  SyncLaneSnapshot,
  SyncLaneStatus,
} from "./syncTelemetry";
export type { UploadSyncLane, UploadSyncLaneOptions } from "./uploadLane";

export interface SyncRuntimeStatus {
  crypto: {
    encapsulationKeyPair: unknown;
  };
  auth: {
    isAuthenticated: boolean;
  };
  state: {
    online: boolean;
  };
}

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

function hasRequestedLaneWork(lanes: Iterable<SyncLaneState>): boolean {
  for (const lane of lanes) {
    if (lane.pumpDriven && lane.requested) {
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

    if (!selectedLane || compareSyncLaneOrder(lane, selectedLane) < 0) {
      selectedLane = lane;
    }
  }

  return selectedLane;
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
    publishSyncCoordinatorSnapshot(coordinatorState);
    let runResult: SyncLaneRunResult | null = null;
    try {
      runResult = await runSyncLane(lane);
    } catch (error: unknown) {
      // Do not clear lane.requested here. A lane's run() can arm a self
      // follow-up (requestLaneSync) before it throws; the `requested` flag is
      // owned by request/selection logic and the success path's finally
      // deliberately leaves it untouched. Clearing it on throw would silently
      // drop a queued structural follow-up — breaking the phase-ordering
      // guarantee in docs/client-sync-ordering.md for any lane without an
      // onUnexpectedError handler (e.g. the structural container-contents lane).
      // The tight-loop risk a re-armed failure would create is handled by the
      // backoff after the finally block below.
      runResult = { status: "failed", error };
      reportUnexpectedSyncLaneError(lane, error);
    } finally {
      lane.running = false;
      lane.lastActionAt = createSyncTimestamp();
      if (runResult?.status === "failed") {
        lane.errorCount += 1;
        lane.lastAction = "failed";
        lane.lastError = describeSyncLaneError(runResult.error);
        lane.lastFailedAt = lane.lastActionAt;
      } else {
        lane.lastAction = "completed";
        lane.lastCompletedAt = lane.lastActionAt;
        lane.lastError = null;
      }
      publishSyncCoordinatorSnapshot(coordinatorState);
    }

    runsSinceMacrotaskYield += 1;

    if (runResult?.status === "failed" && lane.requested) {
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

export function didRegainSyncPrerequisites<TRuntime extends SyncRuntimeStatus>(
  previousRuntime: TRuntime,
  nextRuntime: TRuntime,
): boolean {
  return (
    (!previousRuntime.state.online && nextRuntime.state.online) ||
    (!previousRuntime.auth.isAuthenticated &&
      nextRuntime.auth.isAuthenticated) ||
    (!previousRuntime.crypto.encapsulationKeyPair &&
      !!nextRuntime.crypto.encapsulationKeyPair)
  );
}

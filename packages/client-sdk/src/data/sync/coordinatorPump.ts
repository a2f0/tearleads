import { runCoordinatorLane } from "./coordinatorLaneRun";
import type {
  DomainSyncCoordinatorState,
  SyncLaneState,
} from "./coordinatorState";
import {
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
const DOCUMENT_LANE_CONCURRENCY = 4;
const SYNC_PUMP_MACROTASK_YIELD_INTERVAL = 16;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Priority is a scheduling hint, never permission to abandon active workers.
function readLanePriority(lane: SyncLaneState): number {
  try {
    const priority = lane.config.priority?.() ?? 0;
    return Number.isFinite(priority) ? priority : 0;
  } catch {
    return 0;
  }
}

function compareRequestedLanes(
  left: SyncLaneState,
  right: SyncLaneState,
): number {
  if (
    (left.config.phase ?? "document") !== (right.config.phase ?? "document")
  ) {
    return compareSyncLaneOrder(left, right);
  }
  return (
    readLanePriority(left) - readLanePriority(right) ||
    left.lastRunOrder - right.lastRunOrder ||
    compareSyncLaneOrder(left, right)
  );
}

// An abandoned run still owns its lane. Its eventual settlement will restart
// the pump; trying to restart earlier would spin without runnable work.
function isRequestedLaneAvailable(lane: SyncLaneState): boolean {
  return lane.pumpDriven && lane.requested && lane.activeRunToken === null;
}

function hasRunnableLaneWork(laneValues: Iterable<SyncLaneState>): boolean {
  const lanes = Array.from(laneValues);
  const structuralPending = lanes.some(
    (lane) =>
      lane.config.phase === "structural" && isRequestedLaneAvailable(lane),
  );
  const now = Date.now();
  for (const lane of lanes) {
    if (
      (!structuralPending || lane.config.phase === "structural") &&
      isRequestedLaneAvailable(lane) &&
      (lane.notBeforeAtMs === null || lane.notBeforeAtMs <= now) &&
      !lane.backingOff
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
      (lane.notBeforeAtMs !== null && lane.notBeforeAtMs > now) ||
      lane.backingOff
    ) {
      continue;
    }
    if (!selectedLane || compareRequestedLanes(lane, selectedLane) < 0) {
      selectedLane = lane;
    }
  }

  return selectedLane;
}

async function runRequestedSyncLanes(
  state: DomainSyncCoordinatorState,
): Promise<void> {
  const running = new Map<SyncLaneState, Promise<void>>();
  let startsSinceYield = 0;
  while (!state.disposed || running.size > 0) {
    // Install the wake-up before selecting or starting work. New requests can
    // fill unused workers even while another document is waiting on the network.
    const wakeup = new Promise<void>((resolve) => {
      state.wakePump = resolve;
    });
    let lane = state.disposed
      ? null
      : selectNextRequestedLane(state.lanes.values());
    const structuralPending = Array.from(state.lanes.values()).some(
      (candidate) =>
        candidate.pumpDriven &&
        candidate.config.phase === "structural" &&
        (candidate.running ||
          (candidate.requested && candidate.activeRunToken === null)),
    );
    const structuralRunning = Array.from(running.keys()).some(
      (candidate) => candidate.config.phase === "structural",
    );
    if (
      lane &&
      (running.size >= DOCUMENT_LANE_CONCURRENCY ||
        structuralRunning ||
        (lane.config.phase === "structural"
          ? running.size > 0
          : structuralPending))
    )
      lane = null;
    if (lane) {
      const startedLane = lane;
      lane.lastRunOrder = ++state.nextRunOrder;
      const run = runCoordinatorLane(state, lane, () =>
        scheduleCoordinatorPump(state),
      ).finally(() => {
        running.delete(startedLane);
        state.wakePump?.();
      });
      running.set(lane, run);
      if (++startsSinceYield >= SYNC_PUMP_MACROTASK_YIELD_INTERVAL) {
        await delay(0);
        startsSinceYield = 0;
      }
      continue;
    }
    if (running.size === 0) break;
    await wakeup;
  }
  state.wakePump = null;
}

function scheduleCoordinatorPump(coordinatorState: DomainSyncCoordinatorState) {
  if (coordinatorState.disposed) return;
  if (coordinatorState.pump) {
    coordinatorState.wakePump?.();
    return;
  }

  coordinatorState.pump = Promise.resolve()
    .then(() => runRequestedSyncLanes(coordinatorState))
    .finally(() => {
      coordinatorState.pump = null;
      publishSyncCoordinatorSnapshot(coordinatorState);

      if (
        !coordinatorState.disposed &&
        hasRunnableLaneWork(coordinatorState.lanes.values())
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

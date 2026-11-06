import type { SyncLaneConfig } from "./syncLaneConfig";
import type { SyncLaneRequest, SyncLaneRun } from "./syncLaneMachine";
import {
  hasPendingRequest,
  IDLE_SYNC_LANE_RUN,
  NO_SYNC_LANE_REQUEST,
} from "./syncLaneMachine";
import type {
  DomainSyncSnapshot,
  SyncLaneLastAction,
  SyncLaneProgress,
  SyncLaneRunDurations,
} from "./syncTelemetry";
import { createDomainSyncSnapshot } from "./syncTelemetry";

export interface SyncLaneState {
  lastRunOrder: number;
  blobStorageKey: string | null;
  config: SyncLaneConfig;
  errorCount: number;
  key: string;
  lastAction: SyncLaneLastAction;
  lastActionAt: string;
  lastCompletedAt: string | null;
  lastError: string | null;
  lastFailedAt: string | null;
  lastRequestedAt: string | null;
  lastStartedAt: string | null;
  progress: SyncLaneProgress | null;
  // Registered lanes are driven by the coordinator pump. Blob upload lanes
  // are observational telemetry driven directly by the upload workflow.
  pumpDriven: boolean;
  registrationIndex: number;
  // Written only through transitionSyncLaneRequest: whether a pass is owed.
  request: SyncLaneRequest;
  requestCount: number;
  // Written only through transitionSyncLaneRun. Selection skips a lane whose
  // run is live (running, or abandoned by its watchdog), so a lane never runs
  // concurrently with itself; the late settle frees it and re-pumps.
  run: SyncLaneRun;
  runCount: number;
  runDurations: SyncLaneRunDurations | null;
}

export interface DomainSyncCoordinatorState {
  // Set by dispose(): stop admitting work and drain already-running callbacks
  // (or their watchdogs). No new pump can be scheduled after runtime teardown.
  disposed: boolean;
  lanes: Map<string, SyncLaneState>;
  listeners: Set<() => void>;
  nextRegistrationIndex: number;
  nextRunOrder: number;
  wakePump: (() => void) | null;
  pump: Promise<void> | null;
  snapshot: DomainSyncSnapshot;
}

export const INITIAL_SYNC_LANE_RUN_STATE = {
  lastRunOrder: 0,
  request: NO_SYNC_LANE_REQUEST,
  run: IDLE_SYNC_LANE_RUN,
  runCount: 0,
  runDurations: null,
} as const;

function describeSingleSyncLaneError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }

  return String(error);
}

function readErrorCause(error: unknown): unknown {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  return Reflect.get(error, "cause");
}

export function describeSyncLaneError(error: unknown): string {
  const messages: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;

  while (current !== undefined && current !== null && !seen.has(current)) {
    seen.add(current);
    const message = describeSingleSyncLaneError(current);
    if (message.length > 0) {
      messages.push(message);
    }
    current = readErrorCause(current);
  }

  return messages.length > 0 ? messages.join(" Caused by: ") : String(error);
}

// Observational upload lanes never enter the pump, so their run is never
// invoked; this satisfies the SyncLaneConfig contract without behavior.
export function noopLaneRun(): Promise<void> {
  return Promise.resolve();
}

// Deliberately ignores abandoned runs (unlike the pump's hasRunnableLaneWork):
// a watchdog-abandoned run is detached background work, and idle/pending-work
// reporting must not block on a hung run that may never settle. Its late
// settle still publishes a snapshot and re-pumps any queued re-request.
export function hasPendingLaneWork(lanes: Iterable<SyncLaneState>): boolean {
  for (const lane of lanes) {
    if (hasPendingRequest(lane.request) || lane.run.status === "running") {
      return true;
    }
  }

  return false;
}

export function publishSyncCoordinatorSnapshot(
  state: DomainSyncCoordinatorState,
) {
  state.snapshot = createDomainSyncSnapshot({
    hasPendingWork: !!state.pump || hasPendingLaneWork(state.lanes.values()),
    lanes: state.lanes.values(),
    pumpActive: !!state.pump,
  });
  for (const listener of [...state.listeners]) {
    try {
      listener();
    } catch {
      // Keep one observer failure from blocking sync or later observers.
    }
  }
}

import type { SyncLaneConfig } from "./syncLaneConfig";
import type {
  DomainSyncSnapshot,
  SyncLaneLastAction,
  SyncLaneProgress,
} from "./syncTelemetry";
import { createDomainSyncSnapshot } from "./syncTelemetry";

export interface SyncLaneState {
  // Identity of the lane's live run, set for the duration of a run INCLUDING
  // after a watchdog timeout abandons it. Selection skips lanes whose token is
  // set, so a lane can never run concurrently with its own abandoned run; the
  // late-settle continuation clears it (matching on identity) and re-pumps.
  activeRunToken: object | null;
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
  notBeforeAtMs: number | null;
  progress: SyncLaneProgress | null;
  // Registered lanes are driven by the coordinator pump. Blob upload lanes
  // are observational telemetry driven directly by the upload workflow.
  pumpDriven: boolean;
  registrationIndex: number;
  requestCount: number;
  requested: boolean;
  runAbandoned: boolean;
  runCount: number;
  running: boolean;
}

export interface DomainSyncCoordinatorState {
  // Set by dispose(): the pump force-stops at its next loop check and no new
  // pump can be scheduled, so a coordinator cannot run after its runtime/React
  // tree unmounts.
  disposed: boolean;
  lanes: Map<string, SyncLaneState>;
  listeners: Set<() => void>;
  nextRegistrationIndex: number;
  pump: Promise<void> | null;
  snapshot: DomainSyncSnapshot;
}

export const INITIAL_SYNC_LANE_RUN_STATE = {
  activeRunToken: null,
  runAbandoned: false,
  runCount: 0,
  running: false,
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

// Deliberately ignores activeRunToken (unlike the pump's hasRequestedLaneWork):
// a watchdog-abandoned run is detached background work, and idle/pending-work
// reporting must not block on a hung run that may never settle. Its late
// settle still publishes a snapshot and re-pumps any queued re-request.
export function hasPendingLaneWork(lanes: Iterable<SyncLaneState>): boolean {
  for (const lane of lanes) {
    if (lane.requested || lane.running) {
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

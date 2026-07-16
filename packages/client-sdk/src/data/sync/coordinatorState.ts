import type { SyncLaneConfig } from "./syncLaneConfig";
import type {
  DomainSyncSnapshot,
  SyncLaneLastAction,
  SyncLaneProgress,
} from "./syncTelemetry";
import { createDomainSyncSnapshot } from "./syncTelemetry";

export interface SyncLaneState {
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
  requestCount: number;
  requested: boolean;
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

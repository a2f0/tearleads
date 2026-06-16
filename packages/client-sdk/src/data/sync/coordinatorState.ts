import type { SyncLaneConfig } from "./syncLaneConfig";
import type {
  DomainSyncSnapshot,
  SyncLaneLastAction,
  SyncLaneProgress,
} from "./syncTelemetry";
import { createDomainSyncSnapshot } from "./syncTelemetry";

export interface SyncLaneState {
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
  registrationIndex: number;
  requestCount: number;
  requested: boolean;
  runCount: number;
  running: boolean;
}

export interface DomainSyncCoordinatorState {
  lanes: Map<string, SyncLaneState>;
  listeners: Set<() => void>;
  nextRegistrationIndex: number;
  pump: Promise<void> | null;
  snapshot: DomainSyncSnapshot;
}

export function describeSyncLaneError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

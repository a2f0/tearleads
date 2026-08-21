import type { SyncLanePhase } from "./syncTelemetry";

export interface SyncLane {
  requestSync: () => void;
  requestSyncAfter: (delayMs: number) => void;
}

export interface SyncLaneConfig {
  label?: string | undefined;
  onUnexpectedError?: (error: unknown) => void;
  phase?: SyncLanePhase;
  run: () => Promise<void>;
  shouldIgnoreError?: (error: unknown) => boolean;
  // Per-run liveness bound. When a run exceeds it, the pump records a watchdog
  // failure and moves on to other lanes instead of head-of-line blocking the
  // whole queue; the abandoned run is not cancelled, and its real outcome
  // overwrites the watchdog verdict when it eventually settles. Defaults to
  // the coordinator's SYNC_LANE_WATCHDOG_MS.
  watchdogMs?: number;
}

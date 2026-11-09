import type { SyncLanePhase } from "./syncTelemetry";

export interface SyncLane {
  isDisposed?: () => boolean;
  requestSync: () => void;
  requestSyncAfter: (delayMs: number) => void;
}

/**
 * One drain of the coordinator pump, from its start until no lane runs or is
 * due. Every lane run the drain starts receives the same token, so lanes can
 * scope work they share to one drain; the token dies with the drain.
 */
export type SyncPass = object;

export interface SyncLaneConfig {
  label?: string | undefined;
  onUnexpectedError?: (error: unknown) => void;
  phase?: SyncLanePhase;
  /** Lower values run first within a phase; evaluated at selection time. */
  priority?: (() => number) | undefined;
  /** Observability only. Must not change lane behavior. */
  reportUnexpectedError?: (error: unknown) => void;
  run: (pass: SyncPass) => Promise<void>;
  shouldIgnoreError?: (error: unknown) => boolean;
  // Per-run liveness bound. When a run exceeds it, the pump records a watchdog
  // failure and moves on to other lanes instead of head-of-line blocking the
  // whole queue; the abandoned run is not cancelled, and its real outcome
  // overwrites the watchdog verdict when it eventually settles. Defaults to
  // the coordinator's SYNC_LANE_WATCHDOG_MS.
  watchdogMs?: number;
}

import type { SyncLanePhase } from "./syncTelemetry";

export interface SyncLane {
  requestSync: () => void;
}

export interface SyncLaneConfig {
  label?: string | undefined;
  onUnexpectedError?: (error: unknown) => void;
  phase?: SyncLanePhase;
  run: () => Promise<void>;
  shouldIgnoreError?: (error: unknown) => boolean;
}

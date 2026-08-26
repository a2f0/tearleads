export type SyncLanePhase = "structural" | "document" | "blob";
export type SyncLaneStatus =
  | "idle"
  | "queued"
  | "running"
  | "complete"
  | "error";
export type SyncLaneLastAction =
  | "registered"
  | "requested"
  | "started"
  | "completed"
  | "failed";

/**
 * Fine-grained progress for lanes that expose it (currently multipart blob
 * uploads). Coarse status lanes leave this null and fall back to the
 * status-keyed progress bar in the visualizer.
 */
export interface SyncLaneProgress {
  bytesTotal: number;
  bytesUploaded: number;
  partsCompleted: number;
  partsTotal: number;
}

export interface SyncLaneSnapshot {
  /** Storage key used to open the associated blob, when this is a blob lane. */
  blobStorageKey: string | null;
  errorCount: number;
  key: string;
  label: string;
  lastAction: SyncLaneLastAction;
  lastActionAt: string;
  lastCompletedAt: string | null;
  lastError: string | null;
  lastFailedAt: string | null;
  lastRequestedAt: string | null;
  lastStartedAt: string | null;
  phase: SyncLanePhase;
  progress: SyncLaneProgress | null;
  registrationIndex: number;
  requestCount: number;
  requested: boolean;
  runAbandoned: boolean;
  runCount: number;
  running: boolean;
  status: SyncLaneStatus;
}

export interface DomainSyncSnapshot {
  hasPendingWork: boolean;
  lanes: ReadonlyArray<SyncLaneSnapshot>;
  pumpActive: boolean;
  updatedAt: string;
}

interface SyncLaneTelemetryConfig {
  label?: string | undefined;
  phase?: SyncLanePhase | undefined;
}

interface SyncLaneTelemetryState {
  blobStorageKey: string | null;
  config: SyncLaneTelemetryConfig;
  errorCount: number;
  key: string;
  lastAction: SyncLaneLastAction;
  lastActionAt: string;
  lastCompletedAt: string | null;
  lastError: string | null;
  lastFailedAt: string | null;
  lastRequestedAt: string | null;
  lastStartedAt: string | null;
  progress?: SyncLaneProgress | null;
  registrationIndex: number;
  requestCount: number;
  requested: boolean;
  runAbandoned: boolean;
  runCount: number;
  running: boolean;
}

const DEFAULT_SYNC_LANE_PHASE: SyncLanePhase = "document";
const SYNC_LANE_PHASE_RANK: Record<SyncLanePhase, number> = {
  structural: 0,
  document: 1,
  blob: 2,
};

/**
 * Structural subset of a sync lane needed to order it: its phase and the
 * registration index that breaks phase ties. Accepts both the coordinator's
 * `SyncLaneState` and the telemetry `SyncLaneTelemetryState`.
 */
interface SyncLaneOrderInput {
  config: { phase?: SyncLanePhase | undefined };
  registrationIndex: number;
}

export function createSyncTimestamp(): string {
  return new Date().toISOString();
}

function getSyncLanePhaseRank(state: SyncLaneOrderInput): number {
  return SYNC_LANE_PHASE_RANK[state.config.phase ?? DEFAULT_SYNC_LANE_PHASE];
}

export function compareSyncLaneOrder(
  left: SyncLaneOrderInput,
  right: SyncLaneOrderInput,
): number {
  const phaseRank = getSyncLanePhaseRank(left) - getSyncLanePhaseRank(right);
  if (phaseRank !== 0) {
    return phaseRank;
  }

  return left.registrationIndex - right.registrationIndex;
}

function getSyncLaneStatus(state: SyncLaneTelemetryState): SyncLaneStatus {
  if (state.running) {
    return "running";
  }

  if (state.requested) {
    return "queued";
  }

  if (state.lastAction === "failed") {
    return "error";
  }

  if (state.lastCompletedAt) {
    return "complete";
  }

  return "idle";
}

function createSyncLaneSnapshot(
  state: SyncLaneTelemetryState,
): SyncLaneSnapshot {
  return {
    blobStorageKey: state.blobStorageKey,
    errorCount: state.errorCount,
    key: state.key,
    label: state.config.label ?? state.key,
    lastAction: state.lastAction,
    lastActionAt: state.lastActionAt,
    lastCompletedAt: state.lastCompletedAt,
    lastError: state.lastError,
    lastFailedAt: state.lastFailedAt,
    lastRequestedAt: state.lastRequestedAt,
    lastStartedAt: state.lastStartedAt,
    phase: state.config.phase ?? DEFAULT_SYNC_LANE_PHASE,
    progress: state.progress ?? null,
    registrationIndex: state.registrationIndex,
    requestCount: state.requestCount,
    requested: state.requested,
    runAbandoned: state.runAbandoned,
    runCount: state.runCount,
    running: state.running,
    status: getSyncLaneStatus(state),
  };
}

export function createDomainSyncSnapshot(input: {
  hasPendingWork: boolean;
  lanes: Iterable<SyncLaneTelemetryState>;
  pumpActive: boolean;
}): DomainSyncSnapshot {
  return {
    hasPendingWork: input.hasPendingWork,
    lanes: Array.from(input.lanes)
      .sort(compareSyncLaneOrder)
      .map(createSyncLaneSnapshot),
    pumpActive: input.pumpActive,
    updatedAt: createSyncTimestamp(),
  };
}

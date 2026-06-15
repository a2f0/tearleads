export type SyncLanePhase = "structural" | "document";
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

export interface SyncLaneSnapshot {
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
  registrationIndex: number;
  requestCount: number;
  requested: boolean;
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
  registrationIndex: number;
  requestCount: number;
  requested: boolean;
  runCount: number;
  running: boolean;
}

const DEFAULT_SYNC_LANE_PHASE: SyncLanePhase = "document";
const SYNC_LANE_PHASE_RANK: Record<SyncLanePhase, number> = {
  structural: 0,
  document: 1,
};

export function createSyncTimestamp(): string {
  return new Date().toISOString();
}

export function getSyncLanePhaseRank(state: SyncLaneTelemetryState): number {
  return SYNC_LANE_PHASE_RANK[state.config.phase ?? DEFAULT_SYNC_LANE_PHASE];
}

function compareSyncLaneOrder(
  left: SyncLaneTelemetryState,
  right: SyncLaneTelemetryState,
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
    registrationIndex: state.registrationIndex,
    requestCount: state.requestCount,
    requested: state.requested,
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

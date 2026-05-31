import type { DomainScope } from "../domainScope";

interface SyncRuntimeStatus {
  crypto: {
    encapsulationKeyPair: unknown;
  };
  auth: {
    isAuthenticated: boolean;
  };
  state: {
    online: boolean;
  };
}

export interface SyncLane {
  requestSync: () => void;
}

export type SyncLanePhase = "structural" | "document";

export interface SyncIdleOptions {
  intervalMs?: number;
  quietMs?: number;
  timeoutMs?: number;
}

export interface SyncLaneConfig {
  onUnexpectedError?: (error: unknown) => void;
  phase?: SyncLanePhase;
  run: () => Promise<void>;
  shouldIgnoreError?: (error: unknown) => boolean;
}

interface SyncLaneState {
  config: SyncLaneConfig;
  key: string;
  registrationIndex: number;
  requested: boolean;
  running: boolean;
}

export interface DomainSyncCoordinator {
  registerLane: (key: string, config: SyncLaneConfig) => SyncLane;
  hasPendingWork: () => boolean;
  waitForIdle: (options?: SyncIdleOptions) => Promise<boolean>;
}

interface DomainSyncCoordinatorState {
  lanes: Map<string, SyncLaneState>;
  nextRegistrationIndex: number;
  pump: Promise<void> | null;
}

const coordinatorsByScope = new WeakMap<DomainScope, DomainSyncCoordinator>();
const DEFAULT_SYNC_IDLE_INTERVAL_MS = 10;
const DEFAULT_SYNC_IDLE_QUIET_MS = 0;
const DEFAULT_SYNC_IDLE_TIMEOUT_MS = 500;
const DEFAULT_SYNC_LANE_PHASE: SyncLanePhase = "document";
const SYNC_LANE_PHASE_RANK: Record<SyncLanePhase, number> = {
  structural: 0,
  document: 1,
};
const DESTROYED_DATABASE_CLIENT_MESSAGES = [
  "Database worker client has been destroyed.",
  "DB has been closed.",
] as const;

function getSyncLanePhaseRank(state: SyncLaneState): number {
  return SYNC_LANE_PHASE_RANK[state.config.phase ?? DEFAULT_SYNC_LANE_PHASE];
}

function compareSyncLaneOrder(
  left: SyncLaneState,
  right: SyncLaneState,
): number {
  const phaseRank = getSyncLanePhaseRank(left) - getSyncLanePhaseRank(right);
  if (phaseRank !== 0) {
    return phaseRank;
  }

  return left.registrationIndex - right.registrationIndex;
}

async function runSyncLane(state: SyncLaneState): Promise<void> {
  try {
    await state.config.run();
  } catch (error: unknown) {
    if (state.config.shouldIgnoreError?.(error)) {
      return;
    }

    if (state.config.onUnexpectedError) {
      state.config.onUnexpectedError(error);
      return;
    }

    throw error;
  }
}

function reportUnexpectedSyncLaneError(state: SyncLaneState, error: unknown) {
  console.error(`Failed to run sync lane ${state.key}:`, error);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasPendingLaneWork(lanes: Iterable<SyncLaneState>): boolean {
  for (const lane of lanes) {
    if (lane.requested || lane.running) {
      return true;
    }
  }

  return false;
}

function hasRequestedLaneWork(lanes: Iterable<SyncLaneState>): boolean {
  for (const lane of lanes) {
    if (lane.requested) {
      return true;
    }
  }

  return false;
}

function selectNextRequestedLane(
  lanes: Iterable<SyncLaneState>,
): SyncLaneState | null {
  let selectedLane: SyncLaneState | null = null;

  for (const lane of lanes) {
    if (!lane.requested) {
      continue;
    }

    if (!selectedLane || compareSyncLaneOrder(lane, selectedLane) < 0) {
      selectedLane = lane;
    }
  }

  return selectedLane;
}

async function runRequestedSyncLanes(
  coordinatorState: DomainSyncCoordinatorState,
): Promise<void> {
  while (true) {
    const lane = selectNextRequestedLane(coordinatorState.lanes.values());
    if (!lane) {
      return;
    }

    lane.requested = false;
    lane.running = true;
    try {
      await runSyncLane(lane);
    } catch (error: unknown) {
      lane.requested = false;
      reportUnexpectedSyncLaneError(lane, error);
    } finally {
      lane.running = false;
    }
  }
}

function scheduleCoordinatorPump(coordinatorState: DomainSyncCoordinatorState) {
  if (coordinatorState.pump) {
    return;
  }

  coordinatorState.pump = Promise.resolve()
    .then(() => runRequestedSyncLanes(coordinatorState))
    .finally(() => {
      coordinatorState.pump = null;

      if (hasRequestedLaneWork(coordinatorState.lanes.values())) {
        scheduleCoordinatorPump(coordinatorState);
      }
    });
}

function requestLaneSync(
  coordinatorState: DomainSyncCoordinatorState,
  lane: SyncLaneState,
) {
  lane.requested = true;
  scheduleCoordinatorPump(coordinatorState);
}

async function waitForIdleLanes(
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

function createDomainSyncCoordinator(): DomainSyncCoordinator {
  const coordinatorState: DomainSyncCoordinatorState = {
    lanes: new Map<string, SyncLaneState>(),
    nextRegistrationIndex: 0,
    pump: null,
  };

  return {
    hasPendingWork() {
      return (
        !!coordinatorState.pump ||
        hasPendingLaneWork(coordinatorState.lanes.values())
      );
    },
    registerLane(key: string, config: SyncLaneConfig): SyncLane {
      const existingLane = coordinatorState.lanes.get(key);
      if (existingLane) {
        existingLane.config = config;
        return {
          requestSync: () => requestLaneSync(coordinatorState, existingLane),
        };
      }

      const nextLane: SyncLaneState = {
        config,
        key,
        registrationIndex: coordinatorState.nextRegistrationIndex,
        requested: false,
        running: false,
      };
      coordinatorState.nextRegistrationIndex += 1;
      coordinatorState.lanes.set(key, nextLane);
      return {
        requestSync: () => requestLaneSync(coordinatorState, nextLane),
      };
    },
    waitForIdle(options?: SyncIdleOptions) {
      return waitForIdleLanes(coordinatorState, options);
    },
  };
}

export function getOrCreateDomainSyncCoordinator(
  domainScope: DomainScope,
): DomainSyncCoordinator {
  const existingCoordinator = coordinatorsByScope.get(domainScope);
  if (existingCoordinator) {
    return existingCoordinator;
  }

  const nextCoordinator = createDomainSyncCoordinator();
  coordinatorsByScope.set(domainScope, nextCoordinator);
  return nextCoordinator;
}

export function hasDomainSyncCoordinatorPendingWork(
  domainScope: DomainScope,
): boolean {
  return coordinatorsByScope.get(domainScope)?.hasPendingWork() ?? false;
}

export function waitForDomainSyncCoordinatorToSettle(
  domainScope: DomainScope,
  options?: SyncIdleOptions,
): Promise<boolean> {
  return (
    coordinatorsByScope.get(domainScope)?.waitForIdle(options) ??
    Promise.resolve(true)
  );
}

export function didRegainSyncPrerequisites<TRuntime extends SyncRuntimeStatus>(
  previousRuntime: TRuntime,
  nextRuntime: TRuntime,
): boolean {
  return (
    (!previousRuntime.state.online && nextRuntime.state.online) ||
    (!previousRuntime.auth.isAuthenticated &&
      nextRuntime.auth.isAuthenticated) ||
    (!previousRuntime.crypto.encapsulationKeyPair &&
      !!nextRuntime.crypto.encapsulationKeyPair)
  );
}

export function isDestroyedDatabaseClientError(error: unknown): boolean {
  let current = error;

  while (current instanceof Error) {
    const errorMessage = current.message;
    if (
      DESTROYED_DATABASE_CLIENT_MESSAGES.some((message) =>
        errorMessage.includes(message),
      )
    ) {
      return true;
    }

    current = current.cause;
  }

  return false;
}

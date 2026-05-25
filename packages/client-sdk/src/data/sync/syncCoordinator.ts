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

interface SyncIdleOptions {
  intervalMs?: number;
  quietMs?: number;
  timeoutMs?: number;
}

interface SyncLaneConfig {
  onUnexpectedError?: (error: unknown) => void;
  run: () => Promise<void>;
  shouldIgnoreError?: (error: unknown) => boolean;
}

interface SyncLaneState {
  config: SyncLaneConfig;
  requested: boolean;
  running: Promise<void> | null;
}

interface DomainSyncCoordinator {
  registerLane: (key: string, config: SyncLaneConfig) => SyncLane;
  hasPendingWork: () => boolean;
  waitForIdle: (options?: SyncIdleOptions) => Promise<boolean>;
}

const coordinatorsByScope = new WeakMap<DomainScope, DomainSyncCoordinator>();
const DEFAULT_SYNC_IDLE_INTERVAL_MS = 10;
const DEFAULT_SYNC_IDLE_QUIET_MS = 0;
const DEFAULT_SYNC_IDLE_TIMEOUT_MS = 500;
const DESTROYED_DATABASE_CLIENT_MESSAGES = [
  "Database worker client has been destroyed.",
  "DB has been closed.",
] as const;

function scheduleLane(state: SyncLaneState) {
  state.requested = true;
  if (state.running) {
    return;
  }

  state.running = (async () => {
    while (state.requested) {
      state.requested = false;

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
  })().finally(() => {
    state.running = null;

    if (state.requested) {
      scheduleLane(state);
    }
  });
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

async function waitForIdleLanes(
  lanes: ReadonlyMap<string, SyncLaneState>,
  options: SyncIdleOptions = {},
): Promise<boolean> {
  const intervalMs = options.intervalMs ?? DEFAULT_SYNC_IDLE_INTERVAL_MS;
  const quietMs = options.quietMs ?? DEFAULT_SYNC_IDLE_QUIET_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_SYNC_IDLE_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  let quietStartedAt = Date.now();

  while (Date.now() <= deadline) {
    if (!hasPendingLaneWork(lanes.values())) {
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
  const lanes = new Map<string, SyncLaneState>();

  return {
    hasPendingWork() {
      return hasPendingLaneWork(lanes.values());
    },
    registerLane(key: string, config: SyncLaneConfig): SyncLane {
      const existingLane = lanes.get(key);
      if (existingLane) {
        existingLane.config = config;
        return {
          requestSync: () => scheduleLane(existingLane),
        };
      }

      const nextLane: SyncLaneState = {
        config,
        requested: false,
        running: null,
      };
      lanes.set(key, nextLane);
      return {
        requestSync: () => scheduleLane(nextLane),
      };
    },
    waitForIdle(options?: SyncIdleOptions) {
      return waitForIdleLanes(lanes, options);
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

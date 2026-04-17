interface SyncRuntimeStatus {
  encapsulationKeyPair: unknown;
  isAuthenticated: boolean;
  online: boolean;
}

export interface SyncLane {
  requestSync: () => void;
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
}

const coordinatorsByScope = new WeakMap<object, DomainSyncCoordinator>();

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

function createDomainSyncCoordinator(): DomainSyncCoordinator {
  const lanes = new Map<string, SyncLaneState>();

  return {
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
  };
}

export function getOrCreateDomainSyncCoordinator(
  domainScope: object,
): DomainSyncCoordinator {
  const existingCoordinator = coordinatorsByScope.get(domainScope);
  if (existingCoordinator) {
    return existingCoordinator;
  }

  const nextCoordinator = createDomainSyncCoordinator();
  coordinatorsByScope.set(domainScope, nextCoordinator);
  return nextCoordinator;
}

export function didRegainSyncPrerequisites<TRuntime extends SyncRuntimeStatus>(
  previousRuntime: TRuntime,
  nextRuntime: TRuntime,
): boolean {
  return (
    (!previousRuntime.online && nextRuntime.online) ||
    (!previousRuntime.isAuthenticated && nextRuntime.isAuthenticated) ||
    (!previousRuntime.encapsulationKeyPair &&
      !!nextRuntime.encapsulationKeyPair)
  );
}

export function isDestroyedDatabaseClientError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message === "Database worker client has been destroyed."
  );
}

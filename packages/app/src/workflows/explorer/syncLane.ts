import {
  didRegainSyncPrerequisites,
  getOrCreateDomainSyncCoordinator,
  isDestroyedDatabaseClientError,
  type SyncLane,
} from "../../data/sync/syncCoordinator";

export type ExplorerSyncLane = SyncLane;

interface ExplorerSyncPrerequisiteRuntime {
  readonly encapsulationKeyPair: unknown;
  readonly isAuthenticated: boolean;
  readonly online: boolean;
}

export function registerExplorerSyncLane(input: {
  readonly domainScope: object;
  readonly run: () => Promise<void>;
}): ExplorerSyncLane {
  return getOrCreateDomainSyncCoordinator(input.domainScope).registerLane(
    "explorer",
    {
      run: input.run,
      shouldIgnoreError: isDestroyedExplorerSyncRuntimeError,
    },
  );
}

export function didRegainExplorerSyncPrerequisites(
  previousRuntime: ExplorerSyncPrerequisiteRuntime,
  nextRuntime: ExplorerSyncPrerequisiteRuntime,
): boolean {
  return didRegainSyncPrerequisites(previousRuntime, nextRuntime);
}

export function isDestroyedExplorerSyncRuntimeError(error: unknown): boolean {
  return isDestroyedDatabaseClientError(error);
}

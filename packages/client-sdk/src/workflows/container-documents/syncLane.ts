import {
  didRegainSyncPrerequisites,
  getOrCreateDomainSyncCoordinator,
  isDestroyedDatabaseClientError,
  type SyncLane,
} from "../../data/sync/syncCoordinator";

export type ContainerDocumentsSyncLane = SyncLane;

interface ContainerDocumentsSyncPrerequisiteRuntime {
  readonly encapsulationKeyPair: unknown;
  readonly isAuthenticated: boolean;
  readonly online: boolean;
}

export function registerContainerDocumentsSyncLane(input: {
  readonly domainScope: object;
  readonly run: () => Promise<void>;
}): ContainerDocumentsSyncLane {
  return getOrCreateDomainSyncCoordinator(input.domainScope).registerLane(
    "container-documents",
    {
      run: input.run,
      shouldIgnoreError: isDestroyedContainerDocumentsSyncRuntimeError,
    },
  );
}

export function didRegainContainerDocumentsSyncPrerequisites(
  previousRuntime: ContainerDocumentsSyncPrerequisiteRuntime,
  nextRuntime: ContainerDocumentsSyncPrerequisiteRuntime,
): boolean {
  return didRegainSyncPrerequisites(previousRuntime, nextRuntime);
}

export function isDestroyedContainerDocumentsSyncRuntimeError(
  error: unknown,
): boolean {
  return isDestroyedDatabaseClientError(error);
}

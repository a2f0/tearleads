import type { DomainScope } from "../../data/domainScope";
import {
  didRegainSyncPrerequisites,
  getOrCreateDomainSyncCoordinator,
  isDestroyedDatabaseClientError,
  type SyncLane,
} from "../../data/sync/syncCoordinator";

export type ContainerContentsSyncLane = SyncLane;

interface ContainerContentsSyncPrerequisiteRuntime {
  readonly encapsulationKeyPair: unknown;
  readonly isAuthenticated: boolean;
  readonly online: boolean;
}

export function registerContainerContentsSyncLane(input: {
  readonly domainScope: DomainScope;
  readonly run: () => Promise<void>;
}): ContainerContentsSyncLane {
  return getOrCreateDomainSyncCoordinator(input.domainScope).registerLane(
    "container-contents",
    {
      run: input.run,
      shouldIgnoreError: isDestroyedContainerContentsSyncRuntimeError,
    },
  );
}

export function didRegainContainerContentsSyncPrerequisites(
  previousRuntime: ContainerContentsSyncPrerequisiteRuntime,
  nextRuntime: ContainerContentsSyncPrerequisiteRuntime,
): boolean {
  return didRegainSyncPrerequisites(previousRuntime, nextRuntime);
}

export function isDestroyedContainerContentsSyncRuntimeError(
  error: unknown,
): boolean {
  return isDestroyedDatabaseClientError(error);
}

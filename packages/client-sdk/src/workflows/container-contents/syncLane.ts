import type { DomainScope } from "../../data/domainScope";
import {
  didRegainSyncPrerequisites,
  getOrCreateDomainSyncCoordinator,
  isDestroyedDatabaseClientError,
  type SyncLane,
} from "../../data/sync/syncCoordinator";

export type ContainerContentsSyncLane = SyncLane;

interface ContainerContentsSyncPrerequisiteRuntime {
  readonly auth: {
    readonly isAuthenticated: boolean;
  };
  readonly crypto: {
    readonly encapsulationKeyPair: unknown;
  };
  readonly state: {
    readonly online: boolean;
  };
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

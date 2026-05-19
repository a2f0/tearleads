import {
  didRegainSyncPrerequisites,
  getOrCreateDomainSyncCoordinator,
  isDestroyedDatabaseClientError,
  type SyncLane,
} from "../../data/sync/syncCoordinator";

export type ContactSyncLane = SyncLane;

interface ContactSyncPrerequisiteRuntime {
  readonly encapsulationKeyPair: unknown;
  readonly isAuthenticated: boolean;
  readonly online: boolean;
}

export function registerContactSyncLane(input: {
  readonly domainScope: object;
  readonly run: () => Promise<void>;
}): ContactSyncLane {
  return getOrCreateDomainSyncCoordinator(input.domainScope).registerLane(
    "contacts",
    {
      run: input.run,
      shouldIgnoreError: isDestroyedContactSyncRuntimeError,
    },
  );
}

export function didRegainContactSyncPrerequisites(
  previousRuntime: ContactSyncPrerequisiteRuntime,
  nextRuntime: ContactSyncPrerequisiteRuntime,
): boolean {
  return didRegainSyncPrerequisites(previousRuntime, nextRuntime);
}

export function isDestroyedContactSyncRuntimeError(error: unknown): boolean {
  return isDestroyedDatabaseClientError(error);
}

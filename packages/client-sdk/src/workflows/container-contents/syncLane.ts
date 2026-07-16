import type { DomainScope } from "../../data/domainScope";
import {
  getOrCreateDomainSyncCoordinator,
  isDatabaseUnavailableError,
  type SyncLane,
} from "../../data/sync/syncCoordinator";

export { sequenceUnchanged } from "../../data/sync/sequence";
// Facade re-exports: container-contents stores must reach these shared sync
// helpers through this workflow boundary, not by importing data/sync directly.
export {
  didRegainSyncPrerequisites,
  isDatabaseUnavailableError,
} from "../../data/sync/syncCoordinator";

export type ContainerContentsSyncLane = SyncLane;

function isTransientPrincipalPolicyCacheError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /^Principal policy (group|organization):[^@]+@\d+ is not cached$/u.test(
      error.message,
    )
  );
}

function reportUnexpectedContainerContentsSyncError(error: unknown): void {
  if (isTransientPrincipalPolicyCacheError(error)) {
    return;
  }

  console.error("Failed to run sync lane container-contents:", error);
}

export function registerContainerContentsSyncLane(input: {
  readonly domainScope: DomainScope;
  readonly run: () => Promise<void>;
}): ContainerContentsSyncLane {
  return getOrCreateDomainSyncCoordinator(input.domainScope).registerLane(
    "container-contents",
    {
      label: "Container contents",
      onUnexpectedError: reportUnexpectedContainerContentsSyncError,
      phase: "structural",
      run: input.run,
      shouldIgnoreError: isDatabaseUnavailableError,
    },
  );
}

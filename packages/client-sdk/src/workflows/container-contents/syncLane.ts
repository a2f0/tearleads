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
export const CONTAINER_CONTENTS_SYNC_LANE_KEY = "container-contents";

export function registerContainerContentsSyncLane(input: {
  readonly domainScope: DomainScope;
  readonly run: () => Promise<void>;
}): ContainerContentsSyncLane {
  return getOrCreateDomainSyncCoordinator(input.domainScope).registerLane(
    CONTAINER_CONTENTS_SYNC_LANE_KEY,
    {
      label: "Container contents",
      phase: "structural",
      run: input.run,
      shouldIgnoreError: isDatabaseUnavailableError,
    },
  );
}

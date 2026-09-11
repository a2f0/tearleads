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
  /** Host diagnostics sink; bare runtimes do not structure errors. */
  readonly logError?: ((message: string, error: unknown) => void) | undefined;
  readonly run: () => Promise<void>;
}): ContainerContentsSyncLane {
  return getOrCreateDomainSyncCoordinator(input.domainScope).registerLane(
    CONTAINER_CONTENTS_SYNC_LANE_KEY,
    {
      label: "Container contents",
      phase: "structural",
      // Fixed literal: no container or identity id may reach a report. The
      // mapped stack identifies which lane body threw. Returning the host's
      // result hands a rejection to the lane reporter's wrapper; discarding it
      // would surface as an unhandled rejection instead.
      reportUnexpectedError: (error) =>
        input.logError?.("Container contents: sync lane failed", error),
      run: input.run,
      shouldIgnoreError: isDatabaseUnavailableError,
    },
  );
}

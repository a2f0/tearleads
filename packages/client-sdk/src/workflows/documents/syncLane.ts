import type { DomainScope } from "../../data/domainScope";
import {
  getOrCreateDomainSyncCoordinator,
  isDestroyedDatabaseClientError,
  type SyncLane,
} from "../../data/sync/syncCoordinator";

export { sequenceUnchanged } from "../../data/sync/sequence";
// Facade re-exports: document stores must reach these shared sync helpers
// through this workflow boundary, not by importing data/sync directly.
export { isDestroyedDatabaseClientError } from "../../data/sync/syncCoordinator";

export type DocumentSyncLane = SyncLane;

export function registerDocumentSyncLane(input: {
  readonly domainScope: DomainScope;
  readonly localId: string;
  readonly run: () => Promise<void>;
}): DocumentSyncLane {
  return getOrCreateDomainSyncCoordinator(input.domainScope).registerLane(
    `documents:${input.localId}`,
    {
      label: `Document ${input.localId}`,
      onUnexpectedError: (error) => {
        console.error(`Failed to sync document ${input.localId}:`, error);
      },
      phase: "document",
      run: input.run,
      shouldIgnoreError: isDestroyedDatabaseClientError,
    },
  );
}

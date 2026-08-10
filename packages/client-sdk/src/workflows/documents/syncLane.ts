import type { DomainScope } from "../../data/domainScope";
import {
  getOrCreateDomainSyncCoordinator,
  isDatabaseUnavailableError,
  type SyncLane,
} from "../../data/sync/syncCoordinator";

// Facade re-export: document stores must reach this shared sync helper
// through this workflow boundary, not by importing data/sync directly.
export { sequenceUnchanged } from "../../data/sync/sequence";

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
      shouldIgnoreError: isDatabaseUnavailableError,
    },
  );
}

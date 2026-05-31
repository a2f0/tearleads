import type { DomainScope } from "../../data/domainScope";
import {
  didRegainSyncPrerequisites,
  getOrCreateDomainSyncCoordinator,
  isDestroyedDatabaseClientError,
  type SyncLane,
} from "../../data/sync/syncCoordinator";

export type DocumentSyncLane = SyncLane;

interface DocumentSyncPrerequisiteRuntime {
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

export function registerDocumentSyncLane(input: {
  readonly domainScope: DomainScope;
  readonly localId: string;
  readonly run: () => Promise<void>;
}): DocumentSyncLane {
  return getOrCreateDomainSyncCoordinator(input.domainScope).registerLane(
    `documents:${input.localId}`,
    {
      onUnexpectedError: (error) => {
        console.error(`Failed to sync document ${input.localId}:`, error);
      },
      phase: "document",
      run: input.run,
      shouldIgnoreError: isDestroyedDocumentSyncRuntimeError,
    },
  );
}

export function didRegainDocumentSyncPrerequisites(
  previousRuntime: DocumentSyncPrerequisiteRuntime,
  nextRuntime: DocumentSyncPrerequisiteRuntime,
): boolean {
  return didRegainSyncPrerequisites(previousRuntime, nextRuntime);
}

export function isDestroyedDocumentSyncRuntimeError(error: unknown): boolean {
  return isDestroyedDatabaseClientError(error);
}

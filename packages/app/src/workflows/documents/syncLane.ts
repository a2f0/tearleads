import {
  didRegainSyncPrerequisites,
  getOrCreateDomainSyncCoordinator,
  isDestroyedDatabaseClientError,
  type SyncLane,
} from "../../data/sync/syncCoordinator";

export type DocumentSyncLane = SyncLane;

interface DocumentSyncPrerequisiteRuntime {
  readonly encapsulationKeyPair: unknown;
  readonly isAuthenticated: boolean;
  readonly online: boolean;
}

export function registerDocumentSyncLane(input: {
  readonly domainScope: object;
  readonly localId: string;
  readonly run: () => Promise<void>;
}): DocumentSyncLane {
  return getOrCreateDomainSyncCoordinator(input.domainScope).registerLane(
    `documents:${input.localId}`,
    {
      onUnexpectedError: (error) => {
        console.error(`Failed to sync document ${input.localId}:`, error);
      },
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

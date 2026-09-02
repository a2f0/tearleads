import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import type { MaterializedContainerRekeyPlan } from "../../data/containers/shared/types";
import type { DocumentSyncPullContinuation } from "../../data/documents/shared/syncPagination";
import type { SyncRemoteDocumentResult } from "../../data/documents/shared/types";
import type { PendingUpdateRecord } from "../../data/sqlite/documentPersistence";

export type DocumentSyncContainerRekeyBuilder = (
  writerProjection: DocumentWriterProjectionResponse,
) => Promise<readonly MaterializedContainerRekeyPlan[]>;

export interface RemoteDocumentSyncAttemptState {
  pendingUpdates: readonly PendingUpdateRecord[];
  pullContinuation: DocumentSyncPullContinuation | undefined;
  recoveryPendingUpdatesById: Map<string, PendingUpdateRecord>;
  regenerateQueuedCheckpoints: boolean;
  reusableWriterProjection: DocumentWriterProjectionResponse | null;
}

export type RemoteDocumentSyncAttemptOutcome =
  | { kind: "complete"; result: SyncRemoteDocumentResult | null }
  | { kind: "recover"; updates: Map<string, PendingUpdateRecord> }
  | { kind: "regenerate" }
  | {
      kind: "retry";
      pullContinuation: DocumentSyncPullContinuation | undefined;
    };

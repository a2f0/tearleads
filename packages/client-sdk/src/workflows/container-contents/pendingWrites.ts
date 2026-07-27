import { CONTAINER_METADATA_APP_KIND } from "../../data/persistence/container-contents/containerContentsPersistence";
import { sqlDocumentMoveIntentPersistence } from "../../data/persistence/container-contents/documentMoveIntentPersistence";
import { sqlDocumentsPersistence } from "../../data/persistence/documents/documentsPersistence";
import { DOCUMENTS_APP_KIND } from "../../data/persistence/documents/internal/constants";
import {
  clearDocumentSyncFailure,
  resetDocumentPendingUpdateRekeyBudget,
} from "../../data/sqlite/documentPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { defaultContainerContentsPersistence } from "./containerPersistence";
import { groupPendingWriteCandidates } from "./pendingWrites/aggregation";
import { listDeferredPendingWriteCandidates } from "./pendingWrites/deferredTails";
import { listPersistedPendingWriteCandidates } from "./pendingWrites/sources";
import type { PendingWriteQueueItem } from "./pendingWritesTypes";

export type {
  PendingWriteQueueItem,
  PendingWriteQueueItemStatus,
  PendingWriteQueueObjectKind,
  PendingWriteQueueOperation,
  PendingWriteQueueOperationKind,
  PendingWriteQueueOperationStatus,
} from "./pendingWritesTypes";

/**
 * List identity-wide local state that still requires a remote write. The
 * returned diagnostic contains only navigation/display metadata and aggregate
 * counts; serialized updates, local storage keys, and upload crypto stay below
 * the workflow boundary.
 */
export async function listPendingWrites(
  execSql: ExecSql,
): Promise<ReadonlyArray<PendingWriteQueueItem>> {
  await defaultContainerContentsPersistence.ensureSchema(execSql);
  await sqlDocumentsPersistence.ensureSchema(execSql);
  await sqlDocumentMoveIntentPersistence.ensureSchema(execSql);

  const [persisted, deferred] = await Promise.all([
    listPersistedPendingWriteCandidates(execSql),
    listDeferredPendingWriteCandidates(execSql),
  ]);
  return groupPendingWriteCandidates([...persisted, ...deferred]);
}

/**
 * Explicit manual retry for one write-queue item: clear the recorded
 * terminal failure (the next pass re-records it if it still holds) and, for
 * documents, reset the durable re-key budget so update-id-conflict recovery
 * gets a fresh set of attempts. The cap protects against a server driving a
 * network-speed re-key loop; a deliberate user retry is the rate-limited
 * signal that conditions have changed (e.g. an outage that burned the budget
 * has healed). The caller re-arms the sync lanes afterwards.
 */
export async function resetPendingWriteRetryState(
  execSql: ExecSql,
  input: { localId: string; objectKind: PendingWriteQueueItem["objectKind"] },
): Promise<void> {
  const scope =
    input.objectKind === "container"
      ? { appKind: CONTAINER_METADATA_APP_KIND, localId: input.localId }
      : { appKind: DOCUMENTS_APP_KIND, localId: input.localId };
  if (input.objectKind !== "container") {
    await resetDocumentPendingUpdateRekeyBudget(execSql, scope);
  }
  await clearDocumentSyncFailure(execSql, scope);
}

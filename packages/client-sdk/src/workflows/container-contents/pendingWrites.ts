import { sqlDocumentMoveIntentPersistence } from "../../data/persistence/container-contents/documentMoveIntentPersistence";
import { sqlDocumentsPersistence } from "../../data/persistence/documents/documentsPersistence";
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

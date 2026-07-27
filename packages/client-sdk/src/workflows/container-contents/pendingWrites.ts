import { CONTAINER_METADATA_APP_KIND } from "../../data/persistence/container-contents/containerContentsPersistence";
import { sqlDocumentMoveIntentPersistence } from "../../data/persistence/container-contents/documentMoveIntentPersistence";
import { sqlDocumentsPersistence } from "../../data/persistence/documents/documentsPersistence";
import { DOCUMENTS_APP_KIND } from "../../data/persistence/documents/internal/constants";
import {
  clearDocumentSyncFailure,
  listDocumentPendingUpdates,
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
 * Explicit manual retry for one write-queue item: reset the durable re-key
 * budget for the item's ACTUAL pending-update scope (container metadata and
 * unknown document namespaces re-key through the same recovery path as
 * ordinary documents) and clear the recorded terminal failure — the next
 * pass re-records both if they still hold. The cap protects against a
 * server driving a network-speed re-key loop; a deliberate user retry is
 * the rate-limited signal that conditions have changed (e.g. an outage that
 * burned the budget has healed). The caller re-arms the sync lanes.
 */
export async function resetPendingWriteRetryState(
  execSql: ExecSql,
  input: {
    localId: string;
    /** The item's `namespace` — the unrecognized documents.app_kind, if any. */
    namespace: string | null;
    objectKind: PendingWriteQueueItem["objectKind"];
  },
): Promise<void> {
  const appKind =
    input.objectKind === "container"
      ? CONTAINER_METADATA_APP_KIND
      : (input.namespace ??
        (input.objectKind === "document" ? DOCUMENTS_APP_KIND : null));
  if (appKind === null) {
    // An unknown object kind with no namespace: there is no scope to reset,
    // and guessing one could clear an unrelated scope sharing the localId.
    return;
  }
  const scope = { appKind, localId: input.localId };
  await resetDocumentPendingUpdateRekeyBudget(execSql, scope);
  // Clearing the failure row is part of the re-key budget reset (edge-case
  // row 11) and only makes sense alongside queued work. A failure-only item
  // (a refused revalidation, row 13) has no queued work: its row is the
  // priming ticket that re-drives the store, so it must survive the retry
  // and clear on the next clean pass instead of vanishing with no request.
  const queued = await listDocumentPendingUpdates(execSql, scope);
  if (queued.length > 0) {
    await clearDocumentSyncFailure(execSql, scope);
  }
}

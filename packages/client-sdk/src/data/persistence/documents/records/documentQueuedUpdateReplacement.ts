import { eq, inArray } from "drizzle-orm";
import { documentHistoryUpdates } from "../../../sqlite/schema/documentRecordSchema";
import type { ClientSQLiteTransactionScope } from "../../../sqlite/sqlitePersistenceRuntime";
import {
  documentWriteFenceMatchesInTransaction,
  queuedInScope,
  queueOrder,
} from "./documentPendingUpdatePersistence";
import type {
  DocumentScope,
  PendingUpdateFields,
} from "./documentPersistenceTypes";

/** Replace a run of queued local updates with one merged update. */
export interface QueuedUpdateReplacement {
  expectedDocumentId: string | null;
  expectedRecoveryGeneration: number;
  /** Members' current update ids, in queue order; at least two. */
  memberUpdateIds: readonly string[];
  /** The merged update. It is never a rotation checkpoint. */
  merged: Omit<PendingUpdateFields, "sourceVersionVector">;
  rekeyCount: number;
}

/**
 * The row ids of the members when they are still exactly a contiguous run of
 * ordinary local queued rows, starting with the first listed member;
 * otherwise null.
 */
async function contiguousMemberRowIds(
  tx: ClientSQLiteTransactionScope,
  scope: DocumentScope,
  memberUpdateIds: readonly string[],
): Promise<string[] | null> {
  const queued = await tx
    .select({
      id: documentHistoryUpdates.id,
      origin: documentHistoryUpdates.origin,
      sourceVersionVector: documentHistoryUpdates.sourceVersionVector,
      updateId: documentHistoryUpdates.updateId,
    })
    .from(documentHistoryUpdates)
    .where(queuedInScope(scope))
    .orderBy(...queueOrder());
  const first = queued.findIndex((row) => row.updateId === memberUpdateIds[0]);
  if (first < 0) return null;
  const run = queued.slice(first, first + memberUpdateIds.length);
  const rowIds: string[] = [];
  for (const [index, row] of run.entries()) {
    if (
      row.id === null ||
      row.updateId !== memberUpdateIds[index] ||
      row.origin !== "local" ||
      row.sourceVersionVector !== null
    ) {
      return null;
    }
    rowIds.push(row.id);
  }
  return rowIds.length === memberUpdateIds.length ? rowIds : null;
}

/**
 * The checks and writes of `replaceDocumentQueuedUpdates`, inside the
 * caller's transaction: null unless every check holds.
 */
export async function replaceDocumentQueuedUpdatesInTransaction(
  tx: ClientSQLiteTransactionScope,
  scope: DocumentScope,
  replacement: QueuedUpdateReplacement,
): Promise<string | null> {
  if (!(await documentWriteFenceMatchesInTransaction(tx, scope, replacement))) {
    return null;
  }
  const rowIds = await contiguousMemberRowIds(
    tx,
    scope,
    replacement.memberUpdateIds,
  );
  const [firstRowId, ...mergedAwayRowIds] = rowIds ?? [];
  if (firstRowId === undefined) return null;
  const updateId = crypto.randomUUID();
  await tx
    .update(documentHistoryUpdates)
    .set({
      updateId,
      updateData: replacement.merged.updateData,
      partialStartVersionVector: replacement.merged.partialStartVersionVector,
      partialEndVersionVector: replacement.merged.partialEndVersionVector,
      sourceVersionVector: null,
      rekeyCount: replacement.rekeyCount,
    })
    .where(eq(documentHistoryUpdates.id, firstRowId))
    .run();
  await tx
    .delete(documentHistoryUpdates)
    .where(inArray(documentHistoryUpdates.id, mergedAwayRowIds))
    .run();
  return updateId;
}

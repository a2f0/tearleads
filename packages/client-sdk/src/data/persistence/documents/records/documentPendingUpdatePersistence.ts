import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  lt,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import {
  documentHistoryUpdates,
  documents,
} from "../../../sqlite/schema/documentRecordSchema";
import type { ClientSQLiteTransactionScope } from "../../../sqlite/sqlitePersistenceRuntime";
import type {
  DocumentScope,
  PendingUpdateFields,
  PendingUpdateOrigin,
  QueuedPendingUpdateRecord,
  SelectedPendingUpdateRow,
} from "./documentPersistenceTypes";

/**
 * Queued updates are the rows of the local update log that carry an
 * `updateId`. A tail row (origin "local") stays in the log after settlement as
 * history until compaction; an "outbox" row has no tail role and settlement
 * deletes it.
 */
const OUTBOX_ORIGIN = "outbox";

type QueueStatement = Pick<ClientSQLiteTransactionScope, "delete" | "update">;
type QueueRead = Pick<ClientSQLiteTransactionScope, "selectDistinct">;

export function queuedInScope(scope: DocumentScope) {
  return and(
    eq(documentHistoryUpdates.appKind, scope.appKind),
    eq(documentHistoryUpdates.localId, scope.localId),
    isNotNull(documentHistoryUpdates.updateId),
  );
}

function mapSelectedPendingUpdate(
  row: SelectedPendingUpdateRow,
): QueuedPendingUpdateRecord {
  // A queued row always carries its submission vectors; a row without them
  // cannot be submitted and must fail closed rather than send empty ranges.
  if (
    row.partialStartVersionVector === null ||
    row.partialEndVersionVector === null
  ) {
    throw new Error("Queued document update is missing its version vectors");
  }
  if (row.origin !== "local" && row.origin !== OUTBOX_ORIGIN) {
    throw new Error("Queued document update has an unqueueable origin");
  }
  return {
    id: String(row.id ?? ""),
    origin: row.origin,
    updateData: row.updateData,
    partialStartVersionVector: row.partialStartVersionVector,
    partialEndVersionVector: row.partialEndVersionVector,
    rekeyCount: row.rekeyCount,
  };
}

/** The ids among `localIds` (one app kind) with at least one queued update. */
export async function listLocalIdsWithQueuedUpdates(
  db: QueueRead,
  appKind: string,
  localIds: readonly string[],
): Promise<string[]> {
  const uniqueIds = [...new Set(localIds)];
  if (uniqueIds.length === 0) return [];
  const rows = await db
    .selectDistinct({ localId: documentHistoryUpdates.localId })
    .from(documentHistoryUpdates)
    .where(
      and(
        eq(documentHistoryUpdates.appKind, appKind),
        inArray(documentHistoryUpdates.localId, uniqueIds),
        isNotNull(documentHistoryUpdates.updateId),
      ),
    )
    .orderBy(asc(documentHistoryUpdates.localId));
  return rows.map((row) => row.localId);
}

export async function hasQueuedDocumentUpdates(
  db: QueueRead,
  scope: DocumentScope,
): Promise<boolean> {
  const ids = await listLocalIdsWithQueuedUpdates(db, scope.appKind, [
    scope.localId,
  ]);
  return ids.length > 0;
}

export async function selectDocumentPendingUpdates(
  db: Pick<ClientSQLiteTransactionScope, "select">,
  scope: DocumentScope,
): Promise<QueuedPendingUpdateRecord[]> {
  const rows = await db
    .select({
      id: documentHistoryUpdates.updateId,
      origin: documentHistoryUpdates.origin,
      updateData: documentHistoryUpdates.updateData,
      partialStartVersionVector:
        documentHistoryUpdates.partialStartVersionVector,
      partialEndVersionVector: documentHistoryUpdates.partialEndVersionVector,
      rekeyCount: documentHistoryUpdates.rekeyCount,
    })
    .from(documentHistoryUpdates)
    .where(queuedInScope(scope))
    .orderBy(...queueOrder());

  return rows.map(mapSelectedPendingUpdate);
}

/** Queue order: insertion time, then insertion order within one instant. */
export function queueOrder() {
  return [asc(documentHistoryUpdates.createdAt), asc(sql`rowid`)] as const;
}

/**
 * Write fence inside an open transaction: the scope's document still has the
 * captured server document id and recovery generation.
 */
export async function documentWriteFenceMatchesInTransaction(
  tx: Pick<ClientSQLiteTransactionScope, "select">,
  scope: DocumentScope,
  fence: {
    expectedDocumentId: string | null;
    expectedRecoveryGeneration: number;
  },
): Promise<boolean> {
  const matchingDocuments = await tx
    .select({ localId: documents.localId })
    .from(documents)
    .where(
      and(
        eq(documents.appKind, scope.appKind),
        eq(documents.localId, scope.localId),
        sql`${documents.documentId} IS ${fence.expectedDocumentId}`,
        eq(documents.recoveryGeneration, fence.expectedRecoveryGeneration),
      ),
    )
    .limit(1);
  return matchingDocuments.length > 0;
}

/** One log row for a queued update; `origin` decides its tail role. */
export function queuedUpdateRow(input: {
  createdAt: string;
  origin: PendingUpdateOrigin;
  pendingUpdate: PendingUpdateFields;
  scope: DocumentScope;
  updateId: string;
}) {
  return {
    id: crypto.randomUUID(),
    appKind: input.scope.appKind,
    localId: input.scope.localId,
    updateData: input.pendingUpdate.updateData,
    origin: input.origin,
    createdAt: input.createdAt,
    updateId: input.updateId,
    partialStartVersionVector: input.pendingUpdate.partialStartVersionVector,
    partialEndVersionVector: input.pendingUpdate.partialEndVersionVector,
  };
}

/**
 * Queue an update that has no history-tail role: container metadata (its
 * content is its checkpoint) and full-state re-uploads after a remote reset.
 */
export async function insertDocumentPendingUpdateInTransaction(
  tx: Pick<ClientSQLiteTransactionScope, "insert">,
  input: {
    createdAt: string;
    pendingUpdate: PendingUpdateFields;
    scope: DocumentScope;
    updateId: string;
  },
): Promise<void> {
  await tx
    .insert(documentHistoryUpdates)
    .values(queuedUpdateRow({ ...input, origin: OUTBOX_ORIGIN }))
    .run();
}

export async function insertDocumentPendingUpdateWithHistoryInTransaction(input: {
  createdAt: string;
  pendingUpdate: PendingUpdateFields;
  scope: DocumentScope;
  tx: ClientSQLiteTransactionScope;
}): Promise<string> {
  const updateId = crypto.randomUUID();
  await input.tx
    .insert(documentHistoryUpdates)
    .values(
      queuedUpdateRow({
        createdAt: input.createdAt,
        origin: "local",
        pendingUpdate: input.pendingUpdate,
        scope: input.scope,
        updateId,
      }),
    )
    .run();
  return updateId;
}

/**
 * Assign a fresh id to a queued update, keeping every other column. A lost
 * sync ack leaves the server holding the update under the original id with
 * ciphertext a rebuilt submission can never reproduce (each rebuild encrypts
 * with a fresh IV), so the id is permanently poisoned: every resubmission
 * 409s and the whole outgoing batch rolls back. Re-keying lets the next sync
 * pass submit the same ops under a conflict-free id; the server-side copy is
 * harmless because CRDT update import is idempotent.
 *
 * Returns null when no row carries the id, so callers never report progress
 * for a row that lives in some other queue (or nowhere). The UPDATE's own
 * RETURNING row is the progress signal — a pre-flight SELECT would race a
 * second tab sharing the SQLite file, which can settle the row between the
 * read and the write and turn "rekeyed" into a spurious re-arm.
 *
 * The persisted per-row bound is enforced here as well: a row already at
 * MAX_PENDING_UPDATE_REKEYS is left untouched and reported as no progress.
 * The in-memory lane counter bounds a busy-loop within one session; this
 * bound survives restarts, so a poisoned row cannot re-key forever at three
 * passes per launch.
 */
export const MAX_PENDING_UPDATE_REKEYS = 5;

/** Re-key one queued row below the bound; true when the UPDATE matched it. */
export async function rekeyDocumentPendingUpdateInTransaction(
  tx: Pick<ClientSQLiteTransactionScope, "update">,
  id: string,
  nextId: string,
): Promise<boolean> {
  const updated = await tx
    .update(documentHistoryUpdates)
    .set({
      updateId: nextId,
      rekeyCount: sql`${documentHistoryUpdates.rekeyCount} + 1`,
    })
    .where(
      and(
        eq(documentHistoryUpdates.updateId, id),
        lt(documentHistoryUpdates.rekeyCount, MAX_PENDING_UPDATE_REKEYS),
      ),
    )
    .returning({ id: documentHistoryUpdates.updateId });
  return updated.length > 0;
}

/**
 * Settle queued updates: an outbox row is deleted, and a tail row stops being
 * queued but stays as history until compaction folds it into a checkpoint.
 */
export async function settleQueuedDocumentUpdatesInTransaction(
  tx: QueueStatement,
  scope: DocumentScope,
  updateIds: readonly string[],
): Promise<void> {
  const uniqueIds = [...new Set(updateIds)];
  if (uniqueIds.length === 0) return;
  const selected = and(
    eq(documentHistoryUpdates.appKind, scope.appKind),
    eq(documentHistoryUpdates.localId, scope.localId),
    inArray(documentHistoryUpdates.updateId, uniqueIds),
  );
  await unqueueSelectedUpdates(tx, selected);
}

async function unqueueSelectedUpdates(
  tx: QueueStatement,
  selected: SQL | undefined,
): Promise<void> {
  await tx
    .delete(documentHistoryUpdates)
    .where(and(selected, eq(documentHistoryUpdates.origin, OUTBOX_ORIGIN)))
    .run();
  await tx
    .update(documentHistoryUpdates)
    .set({
      updateId: null,
      partialStartVersionVector: null,
      partialEndVersionVector: null,
      rekeyCount: 0,
    })
    .where(selected)
    .run();
}

/** Settle one queued update by id, whatever its scope. */
export async function settleDocumentPendingUpdateInTransaction(
  tx: QueueStatement,
  id: string,
): Promise<void> {
  await unqueueSelectedUpdates(tx, eq(documentHistoryUpdates.updateId, id));
}

/**
 * Stop queueing every update in the given scopes: outbox rows are dropped,
 * and local tail rows keep their content as history (it is already in the
 * document).
 */
export async function unqueueDocumentScopesInTransaction(
  tx: QueueStatement,
  scopes: readonly DocumentScope[],
): Promise<void> {
  if (scopes.length === 0) return;
  await unqueueSelectedUpdates(tx, or(...scopes.map(queuedInScope)));
}

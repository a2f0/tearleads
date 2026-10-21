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
import { documentHistoryUpdates, documents } from "../../../sqlite/schema";
import type { ClientSQLiteTransactionScope } from "../../../sqlite/sqlitePersistenceRuntime";
import { getClientSQLitePersistenceRuntime } from "../../../sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../../../sqlite/sqlSchema";
import type {
  DocumentScope,
  PendingUpdateFields,
  PendingUpdateRecord,
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

function queuedInScope(scope: DocumentScope) {
  return and(
    eq(documentHistoryUpdates.appKind, scope.appKind),
    eq(documentHistoryUpdates.localId, scope.localId),
    isNotNull(documentHistoryUpdates.updateId),
  );
}

function mapSelectedPendingUpdate(
  row: SelectedPendingUpdateRow,
): PendingUpdateRecord {
  // A queued row always carries its submission vectors; a row without them
  // cannot be submitted and must fail closed rather than send empty ranges.
  if (
    row.partialStartVersionVector === null ||
    row.partialEndVersionVector === null
  ) {
    throw new Error("Queued document update is missing its version vectors");
  }
  return {
    id: String(row.id ?? ""),
    updateData: row.updateData,
    partialStartVersionVector: row.partialStartVersionVector,
    partialEndVersionVector: row.partialEndVersionVector,
    sourceVersionVector: row.sourceVersionVector,
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

export async function listDocumentPendingUpdates(
  execSql: ExecSql,
  scope: DocumentScope,
): Promise<PendingUpdateRecord[]> {
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const rows = await db
    .select({
      id: documentHistoryUpdates.updateId,
      updateData: documentHistoryUpdates.updateData,
      partialStartVersionVector:
        documentHistoryUpdates.partialStartVersionVector,
      partialEndVersionVector: documentHistoryUpdates.partialEndVersionVector,
      sourceVersionVector: documentHistoryUpdates.sourceVersionVector,
      rekeyCount: documentHistoryUpdates.rekeyCount,
    })
    .from(documentHistoryUpdates)
    .where(queuedInScope(scope))
    .orderBy(asc(documentHistoryUpdates.createdAt), asc(sql`rowid`));

  return rows.map(mapSelectedPendingUpdate);
}

/** One log row for a queued update; `origin` decides its tail role. */
export function queuedUpdateRow(input: {
  createdAt: string;
  origin: "local" | typeof OUTBOX_ORIGIN;
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
    sourceVersionVector: input.pendingUpdate.sourceVersionVector ?? null,
  };
}

/**
 * Queue an update that has no history-tail role: container metadata (its
 * content is its checkpoint) and full-state re-uploads after a remote reset.
 */
export async function enqueueDocumentPendingUpdate(
  execSql: ExecSql,
  scope: DocumentScope,
  pendingUpdate: PendingUpdateFields,
): Promise<string> {
  const updateId = crypto.randomUUID();
  await getClientSQLitePersistenceRuntime(execSql).runMutation(async (db) => {
    await db
      .insert(documentHistoryUpdates)
      .values(
        queuedUpdateRow({
          createdAt: new Date().toISOString(),
          origin: OUTBOX_ORIGIN,
          pendingUpdate,
          scope,
          updateId,
        }),
      )
      .run();
  });
  return updateId;
}

/**
 * Append a locally authored update to the history tail AND queue it, as one
 * row in one transaction. A crash can therefore never leave the op restorable
 * from history while missing from the outgoing queue, where a null-marker
 * restore would classify it as covered and never send it.
 */
export async function enqueueDocumentPendingUpdateWithHistory(
  execSql: ExecSql,
  scope: DocumentScope,
  pendingUpdate: PendingUpdateFields,
  options?: {
    expectedDocumentId: string | null;
    expectedRecoveryGeneration: number;
  },
): Promise<string | null> {
  const createdAt = new Date().toISOString();
  return getClientSQLitePersistenceRuntime(execSql).transaction(
    async (tx) => {
      if (options) {
        const matchingDocuments = await tx
          .select({ localId: documents.localId })
          .from(documents)
          .where(
            and(
              eq(documents.appKind, scope.appKind),
              eq(documents.localId, scope.localId),
              sql`${documents.documentId} IS ${options.expectedDocumentId}`,
              eq(
                documents.recoveryGeneration,
                options.expectedRecoveryGeneration,
              ),
            ),
          )
          .limit(1);
        if (matchingDocuments.length === 0) {
          return null;
        }
      }

      return insertDocumentPendingUpdateWithHistoryInTransaction({
        createdAt,
        pendingUpdate,
        scope,
        tx,
      });
    },
    { behavior: "immediate" },
  );
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

/**
 * Reset the durable re-key budget for every queued update in a scope. The
 * cap exists to stop a server that keeps conflicting fresh ids from driving
 * a network-speed loop — but a budget burned during an unrelated outage
 * (e.g. yesterday's stale-bundle deadlock 409ing every submit) should not be
 * terminal forever. An explicit manual retry is the deliberate, rate-limited
 * signal that conditions changed, so it gets a fresh budget.
 */
export async function resetDocumentPendingUpdateRekeyBudget(
  execSql: ExecSql,
  scope: DocumentScope,
): Promise<void> {
  await getClientSQLitePersistenceRuntime(execSql).runMutation(async (db) => {
    await db
      .update(documentHistoryUpdates)
      .set({ rekeyCount: 0 })
      .where(queuedInScope(scope));
  });
}

export async function rekeyDocumentPendingUpdate(
  execSql: ExecSql,
  id: string,
): Promise<string | null> {
  const nextId = crypto.randomUUID();
  let rekeyed = false;
  await getClientSQLitePersistenceRuntime(execSql).runMutation(async (db) => {
    const updated = await db
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
    rekeyed = updated.length > 0;
  });
  return rekeyed ? nextId : null;
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
      sourceVersionVector: null,
      rekeyCount: 0,
    })
    .where(selected)
    .run();
}

/** Settle one queued update by id, whatever its scope. */
export async function settleDocumentPendingUpdate(
  execSql: ExecSql,
  id: string,
): Promise<void> {
  await getClientSQLitePersistenceRuntime(execSql).runMutation(async (db) => {
    await unqueueSelectedUpdates(db, eq(documentHistoryUpdates.updateId, id));
  });
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

export async function unqueueDocumentPendingUpdates(
  execSql: ExecSql,
  scope: DocumentScope,
): Promise<void> {
  await getClientSQLitePersistenceRuntime(execSql).runMutation(async (db) => {
    await unqueueDocumentScopesInTransaction(db, [scope]);
  });
}

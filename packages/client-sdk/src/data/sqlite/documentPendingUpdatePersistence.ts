import { and, asc, eq, lt, sql } from "drizzle-orm";
import type {
  DocumentScope,
  PendingUpdateFields,
  PendingUpdateRecord,
  SelectedPendingUpdateRow,
} from "./documentPersistenceTypes";
import { documentHistoryUpdates, documentPendingUpdates } from "./schema";
import { getClientSQLitePersistenceRuntime } from "./sqlitePersistenceRuntime";
import type { ExecSql } from "./sqlSchema";

function mapSelectedPendingUpdate(
  row: SelectedPendingUpdateRow,
): PendingUpdateRecord {
  return {
    id: String(row.id ?? ""),
    updateData: row.updateData,
    partialStartVersionVector: row.partialStartVersionVector,
    partialEndVersionVector: row.partialEndVersionVector,
    sourceVersionVector: row.sourceVersionVector,
    rekeyCount: row.rekeyCount,
  };
}

export async function listDocumentPendingUpdates(
  execSql: ExecSql,
  scope: DocumentScope,
): Promise<PendingUpdateRecord[]> {
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const rows = await db
    .select({
      id: documentPendingUpdates.id,
      updateData: documentPendingUpdates.updateData,
      partialStartVersionVector:
        documentPendingUpdates.partialStartVersionVector,
      partialEndVersionVector: documentPendingUpdates.partialEndVersionVector,
      sourceVersionVector: documentPendingUpdates.sourceVersionVector,
      rekeyCount: documentPendingUpdates.rekeyCount,
    })
    .from(documentPendingUpdates)
    .where(
      and(
        eq(documentPendingUpdates.appKind, scope.appKind),
        eq(documentPendingUpdates.localId, scope.localId),
      ),
    )
    .orderBy(asc(documentPendingUpdates.createdAt), asc(sql`rowid`));

  return rows.map(mapSelectedPendingUpdate);
}

export async function enqueueDocumentPendingUpdate(
  execSql: ExecSql,
  scope: DocumentScope,
  pendingUpdate: PendingUpdateFields,
): Promise<void> {
  await getClientSQLitePersistenceRuntime(execSql).runMutation(async (db) => {
    await db
      .insert(documentPendingUpdates)
      .values({
        id: crypto.randomUUID(),
        appKind: scope.appKind,
        localId: scope.localId,
        updateData: pendingUpdate.updateData,
        partialStartVersionVector: pendingUpdate.partialStartVersionVector,
        partialEndVersionVector: pendingUpdate.partialEndVersionVector,
        sourceVersionVector: pendingUpdate.sourceVersionVector ?? null,
        createdAt: new Date().toISOString(),
      })
      .run();
  });
}

/**
 * Enqueue an outgoing update AND append it to the durable-history tail in a
 * single transaction. Serialization alone is not enough: a crash between
 * separate inserts could leave the op restorable from history while missing
 * from the outgoing queue, and a null-marker restore would then classify it
 * as covered and never send it.
 */
export async function enqueueDocumentPendingUpdateWithHistory(
  execSql: ExecSql,
  scope: DocumentScope,
  pendingUpdate: PendingUpdateFields,
): Promise<void> {
  const createdAt = new Date().toISOString();
  await getClientSQLitePersistenceRuntime(execSql).transaction(async (tx) => {
    await tx
      .insert(documentHistoryUpdates)
      .values({
        id: crypto.randomUUID(),
        appKind: scope.appKind,
        localId: scope.localId,
        updateData: pendingUpdate.updateData,
        createdAt,
      })
      .run();
    await tx
      .insert(documentPendingUpdates)
      .values({
        id: crypto.randomUUID(),
        appKind: scope.appKind,
        localId: scope.localId,
        updateData: pendingUpdate.updateData,
        partialStartVersionVector: pendingUpdate.partialStartVersionVector,
        partialEndVersionVector: pendingUpdate.partialEndVersionVector,
        sourceVersionVector: pendingUpdate.sourceVersionVector ?? null,
        createdAt,
      })
      .run();
  });
}

/**
 * Assign a fresh id to a pending update, keeping every other column. A lost
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
 * second tab sharing the SQLite file, which can settle-delete the row between
 * the read and the write and turn "rekeyed" into a spurious re-arm.
 *
 * The persisted per-row bound is enforced here as well: a row already at
 * MAX_PENDING_UPDATE_REKEYS is left untouched and reported as no progress.
 * The in-memory lane counter bounds a busy-loop within one session; this
 * bound survives restarts, so a poisoned row cannot re-key forever at three
 * passes per launch.
 */
export const MAX_PENDING_UPDATE_REKEYS = 5;

/**
 * Reset the durable re-key budget for every pending update in a scope. The
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
      .update(documentPendingUpdates)
      .set({ rekeyCount: 0 })
      .where(
        and(
          eq(documentPendingUpdates.appKind, scope.appKind),
          eq(documentPendingUpdates.localId, scope.localId),
        ),
      );
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
      .update(documentPendingUpdates)
      .set({
        id: nextId,
        rekeyCount: sql`${documentPendingUpdates.rekeyCount} + 1`,
      })
      .where(
        and(
          eq(documentPendingUpdates.id, id),
          lt(documentPendingUpdates.rekeyCount, MAX_PENDING_UPDATE_REKEYS),
        ),
      )
      .returning({ id: documentPendingUpdates.id });
    rekeyed = updated.length > 0;
  });
  return rekeyed ? nextId : null;
}

export async function deleteDocumentPendingUpdate(
  execSql: ExecSql,
  id: string,
): Promise<void> {
  await getClientSQLitePersistenceRuntime(execSql).runMutation(async (db) => {
    await db
      .delete(documentPendingUpdates)
      .where(eq(documentPendingUpdates.id, id))
      .run();
  });
}

export async function deleteDocumentPendingUpdates(
  execSql: ExecSql,
  scope: DocumentScope,
): Promise<void> {
  await getClientSQLitePersistenceRuntime(execSql).runMutation(async (db) => {
    await db
      .delete(documentPendingUpdates)
      .where(
        and(
          eq(documentPendingUpdates.appKind, scope.appKind),
          eq(documentPendingUpdates.localId, scope.localId),
        ),
      )
      .run();
  });
}

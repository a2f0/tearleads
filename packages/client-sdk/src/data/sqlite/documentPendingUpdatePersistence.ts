import { and, asc, eq, sql } from "drizzle-orm";
import type {
  DocumentScope,
  PendingUpdateFields,
  PendingUpdateRecord,
  SelectedPendingUpdateRow,
} from "./documentPersistenceTypes";
import { documentPendingUpdates } from "./schema";
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
 * Assign a fresh id to a pending update, keeping every other column. A lost
 * sync ack leaves the server holding the update under the original id with
 * ciphertext a rebuilt submission can never reproduce (each rebuild encrypts
 * with a fresh IV), so the id is permanently poisoned: every resubmission
 * 409s and the whole outgoing batch rolls back. Re-keying lets the next sync
 * pass submit the same ops under a conflict-free id; the server-side copy is
 * harmless because CRDT update import is idempotent.
 */
export async function rekeyDocumentPendingUpdate(
  execSql: ExecSql,
  id: string,
): Promise<string> {
  const nextId = crypto.randomUUID();
  await getClientSQLitePersistenceRuntime(execSql).runMutation(async (db) => {
    await db
      .update(documentPendingUpdates)
      .set({ id: nextId })
      .where(eq(documentPendingUpdates.id, id))
      .run();
  });
  return nextId;
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

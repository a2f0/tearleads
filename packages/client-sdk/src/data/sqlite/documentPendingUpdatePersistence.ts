import { and, asc, eq, sql } from "drizzle-orm";
import { getClientDatabaseRuntime } from "./clientDatabaseRuntime";
import type {
  DocumentScope,
  PendingUpdateFields,
  PendingUpdateRecord,
  SelectedPendingUpdateRow,
} from "./documentPersistenceTypes";
import { documentPendingUpdates } from "./schema";
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
  const { db } = getClientDatabaseRuntime(execSql);
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
  await getClientDatabaseRuntime(execSql).runMutation(async (db) => {
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

export async function deleteDocumentPendingUpdate(
  execSql: ExecSql,
  id: string,
): Promise<void> {
  await getClientDatabaseRuntime(execSql).runMutation(async (db) => {
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
  await getClientDatabaseRuntime(execSql).runMutation(async (db) => {
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

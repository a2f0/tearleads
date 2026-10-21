import { and, eq, inArray } from "drizzle-orm";
import {
  documentHistoryCheckpoints,
  documentHistoryUpdates,
  documents,
} from "../../../sqlite/schema";
import type { ClientSQLiteTransactionScope } from "../../../sqlite/sqlitePersistenceRuntime";

// Document rows written inside another subsystem's transaction. Container
// Contents stores each folder's metadata document in these tables, so it
// saves, rebinds, and deletes those rows through here.

/** Inserts or replaces one document row. */
export async function upsertDocumentRowInTransaction(
  tx: ClientSQLiteTransactionScope,
  row: typeof documents.$inferInsert,
): Promise<void> {
  await tx
    .insert(documents)
    .values(row)
    .onConflictDoUpdate({
      target: [documents.appKind, documents.localId],
      set: row,
    })
    .run();
}

/** Inserts or replaces one document's history checkpoint. */
export async function upsertDocumentHistoryCheckpointInTransaction(
  tx: ClientSQLiteTransactionScope,
  row: typeof documentHistoryCheckpoints.$inferInsert,
): Promise<void> {
  await tx
    .insert(documentHistoryCheckpoints)
    .values(row)
    .onConflictDoUpdate({
      target: [
        documentHistoryCheckpoints.appKind,
        documentHistoryCheckpoints.localId,
      ],
      set: row,
    })
    .run();
}

/** Deletes the record, checkpoint, and history rows of documents of one kind. */
export async function deleteDocumentScopeRowsInTransaction(
  tx: ClientSQLiteTransactionScope,
  appKind: string,
  localIds: ReadonlyArray<string>,
): Promise<void> {
  const ids = [...localIds];
  await tx
    .delete(documents)
    .where(and(eq(documents.appKind, appKind), inArray(documents.localId, ids)))
    .run();
  await tx
    .delete(documentHistoryCheckpoints)
    .where(
      and(
        eq(documentHistoryCheckpoints.appKind, appKind),
        inArray(documentHistoryCheckpoints.localId, ids),
      ),
    )
    .run();
  await tx
    .delete(documentHistoryUpdates)
    .where(
      and(
        eq(documentHistoryUpdates.appKind, appKind),
        inArray(documentHistoryUpdates.localId, ids),
      ),
    )
    .run();
}

/**
 * Points a document row at a new server document and drops the keys, manifest,
 * and sync position it held for the old one.
 */
export async function rebindDocumentRowInTransaction(
  tx: ClientSQLiteTransactionScope,
  scope: { readonly appKind: string; readonly localId: string },
  rebind: { readonly documentId: string; readonly updatedAt: string },
): Promise<void> {
  await tx
    .update(documents)
    .set({
      accessEpoch: 1,
      accessStateHash: null,
      contentKeyBundle: null,
      documentId: rebind.documentId,
      documentKekTargets: null,
      documentManifestBundle: null,
      lastCommitLsn: null,
      pullContinuation: null,
      updatedAt: rebind.updatedAt,
    })
    .where(
      and(
        eq(documents.appKind, scope.appKind),
        eq(documents.localId, scope.localId),
      ),
    )
    .run();
}

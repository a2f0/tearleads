import { and, eq, notExists, type SQL } from "drizzle-orm";
import { documentOrphanBlobReclaims } from "../../../sqlite/documentOrphanBlobReclaims";
import {
  documentAttachmentBlobProjection,
  documentHistoryCheckpoints,
  documentHistoryUpdates,
  documentPendingAttachments,
  documentPendingUpdates,
  documentSyncFailures,
  documents,
} from "../../../sqlite/schema";
import {
  type ClientSQLiteTransaction,
  getClientSQLitePersistenceRuntime,
} from "../../../sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../../../sqlite/sqlSchema";
import { DOCUMENTS_APP_KIND } from "./constants";

type DocumentSideLocalIdColumn =
  | typeof documentAttachmentBlobProjection.localId
  | typeof documentHistoryCheckpoints.localId
  | typeof documentHistoryUpdates.localId
  | typeof documentPendingAttachments.localId
  | typeof documentPendingUpdates.localId
  | typeof documentSyncFailures.localId;

function hasNoDocument(
  tx: ClientSQLiteTransaction,
  localId: DocumentSideLocalIdColumn,
): SQL {
  return notExists(
    tx
      .select({ localId: documents.localId })
      .from(documents)
      .where(
        and(
          eq(documents.appKind, DOCUMENTS_APP_KIND),
          eq(documents.localId, localId),
        ),
      ),
  );
}

/** Remove document side writes left behind without a canonical record row. */
export async function deleteOrphanedDocumentSideRows(
  execSql: ExecSql,
): Promise<void> {
  await getClientSQLitePersistenceRuntime(execSql).transaction(async (tx) => {
    const [pendingAttachmentRows, localAttachmentRows] = await Promise.all([
      tx
        .select({ storageKey: documentPendingAttachments.storageKey })
        .from(documentPendingAttachments)
        .where(hasNoDocument(tx, documentPendingAttachments.localId)),
      tx
        .select({ storageKey: documentAttachmentBlobProjection.storageKey })
        .from(documentAttachmentBlobProjection)
        .where(hasNoDocument(tx, documentAttachmentBlobProjection.localId)),
    ]);
    const storageKeys = [
      ...new Set(
        [...pendingAttachmentRows, ...localAttachmentRows].map(
          (row) => row.storageKey,
        ),
      ),
    ];
    if (storageKeys.length > 0) {
      await tx
        .insert(documentOrphanBlobReclaims)
        .values(storageKeys.map((storageKey) => ({ storageKey })))
        .onConflictDoNothing()
        .run();
    }
    await tx
      .delete(documentHistoryCheckpoints)
      .where(
        and(
          eq(documentHistoryCheckpoints.appKind, DOCUMENTS_APP_KIND),
          hasNoDocument(tx, documentHistoryCheckpoints.localId),
        ),
      )
      .run();
    await tx
      .delete(documentHistoryUpdates)
      .where(
        and(
          eq(documentHistoryUpdates.appKind, DOCUMENTS_APP_KIND),
          hasNoDocument(tx, documentHistoryUpdates.localId),
        ),
      )
      .run();
    await tx
      .delete(documentPendingUpdates)
      .where(
        and(
          eq(documentPendingUpdates.appKind, DOCUMENTS_APP_KIND),
          hasNoDocument(tx, documentPendingUpdates.localId),
        ),
      )
      .run();
    await tx
      .delete(documentSyncFailures)
      .where(
        and(
          eq(documentSyncFailures.appKind, DOCUMENTS_APP_KIND),
          hasNoDocument(tx, documentSyncFailures.localId),
        ),
      )
      .run();
    await tx
      .delete(documentPendingAttachments)
      .where(hasNoDocument(tx, documentPendingAttachments.localId))
      .run();
    await tx
      .delete(documentAttachmentBlobProjection)
      .where(hasNoDocument(tx, documentAttachmentBlobProjection.localId))
      .run();
  });
}

export async function listDocumentOrphanBlobReclaims(
  execSql: ExecSql,
): Promise<ReadonlyArray<string>> {
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const rows = await db
    .select({ storageKey: documentOrphanBlobReclaims.storageKey })
    .from(documentOrphanBlobReclaims);
  return rows.map((row) => row.storageKey);
}

export async function isDocumentBlobStorageKeyReferenced(
  execSql: ExecSql,
  storageKey: string,
): Promise<boolean> {
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const [pendingRows, localRows] = await Promise.all([
    db
      .select({ storageKey: documentPendingAttachments.storageKey })
      .from(documentPendingAttachments)
      .where(eq(documentPendingAttachments.storageKey, storageKey))
      .limit(1),
    db
      .select({ storageKey: documentAttachmentBlobProjection.storageKey })
      .from(documentAttachmentBlobProjection)
      .where(eq(documentAttachmentBlobProjection.storageKey, storageKey))
      .limit(1),
  ]);
  return pendingRows.length > 0 || localRows.length > 0;
}

export async function acknowledgeDocumentOrphanBlobReclaim(
  execSql: ExecSql,
  storageKey: string,
): Promise<void> {
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  await db
    .delete(documentOrphanBlobReclaims)
    .where(eq(documentOrphanBlobReclaims.storageKey, storageKey))
    .run();
}

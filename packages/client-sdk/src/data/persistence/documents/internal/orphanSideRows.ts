import { and, eq, notExists, type SQL } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
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

function hasNoDocument(
  tx: ClientSQLiteTransaction,
  localId: SQLiteColumn,
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

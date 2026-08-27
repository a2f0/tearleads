import { and, eq, ne } from "drizzle-orm";
import { deleteDocumentHistory } from "../../../sqlite/documentHistoryPersistence";
import {
  clearDocumentSyncFailure,
  deleteDocumentPendingUpdates,
  deleteDocumentRecord,
  loadDocumentRecord,
} from "../../../sqlite/documentPersistence";
import {
  documentAttachmentBlobProjection,
  documentContainerProjection,
  documentMoveIntents,
  documentMoveIntentTables,
  documentPendingAttachments,
  documentProjection,
  documentProjectionText,
  documents,
} from "../../../sqlite/schema";
import {
  type ClientSQLiteTransactionScope,
  getClientSQLitePersistenceRuntime,
} from "../../../sqlite/sqlitePersistenceRuntime";
import {
  type ExecSql,
  ensureSqlTables,
  runSerializedSqlMutation,
} from "../../../sqlite/sqlSchema";
import type { StoredDocumentRecord } from "../types";
import { DOCUMENTS_APP_KIND } from "./constants";
import { sameCanonicalDocumentSecurityIdentity } from "./documentRecordIdentity";
import { getDocumentScope } from "./documentRows";
import { queueDocumentAttachmentBlobReclaims } from "./orphanSideRows";

async function deleteStoredDocumentRows(input: {
  existingDocumentId: string | null;
  localId: string;
  lockedExecSql: ExecSql;
  tx: ClientSQLiteTransactionScope;
}): Promise<void> {
  const { existingDocumentId, localId, lockedExecSql, tx } = input;
  await queueDocumentAttachmentBlobReclaims({
    localWhere: eq(documentAttachmentBlobProjection.localId, localId),
    pendingWhere: eq(documentPendingAttachments.localId, localId),
    tx,
  });
  await tx
    .delete(documentProjection)
    .where(eq(documentProjection.localId, localId))
    .run();
  await tx
    .delete(documentProjectionText)
    .where(eq(documentProjectionText.localId, localId))
    .run();
  await tx
    .delete(documentPendingAttachments)
    .where(eq(documentPendingAttachments.localId, localId))
    .run();
  await tx
    .delete(documentAttachmentBlobProjection)
    .where(eq(documentAttachmentBlobProjection.localId, localId))
    .run();
  if (existingDocumentId) {
    await tx
      .delete(documentContainerProjection)
      .where(eq(documentContainerProjection.documentId, existingDocumentId))
      .run();
    await tx
      .delete(documentMoveIntents)
      .where(eq(documentMoveIntents.documentId, existingDocumentId))
      .run();
  }
  const scope = getDocumentScope(localId);
  await deleteDocumentPendingUpdates(lockedExecSql, scope);
  await deleteDocumentHistory(lockedExecSql, scope);
  await clearDocumentSyncFailure(lockedExecSql, scope);
  await deleteDocumentRecord(lockedExecSql, scope);
}

async function ensureDocumentDeletionTables(execSql: ExecSql): Promise<void> {
  // Move intents live in the container-contents schema, which document-only
  // callers may not have initialized yet.
  await ensureSqlTables(execSql, documentMoveIntentTables);
}

async function hasAnotherDocumentAlias(input: {
  documentId: string;
  localId: string;
  tx: ClientSQLiteTransactionScope;
}): Promise<boolean> {
  const rows = await input.tx
    .select({ localId: documents.localId })
    .from(documents)
    .where(
      and(
        eq(documents.appKind, DOCUMENTS_APP_KIND),
        eq(documents.documentId, input.documentId),
        ne(documents.localId, input.localId),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export async function deleteStoredDocument(
  execSql: ExecSql,
  localId: string,
): Promise<void> {
  await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
    await ensureDocumentDeletionTables(lockedExecSql);
    await getClientSQLitePersistenceRuntime(lockedExecSql).transaction(
      async (tx) => {
        const existingDocument = await loadDocumentRecord(lockedExecSql, {
          appKind: DOCUMENTS_APP_KIND,
          localId,
        });
        await deleteStoredDocumentRows({
          existingDocumentId: existingDocument?.documentId ?? null,
          localId,
          lockedExecSql,
          tx,
        });
      },
      { behavior: "immediate" },
    );
  });
}

export async function deleteStoredDocumentIfMatches(
  execSql: ExecSql,
  expectedRecord: StoredDocumentRecord,
  deleteClientProjection: (transactionExecSql: ExecSql) => Promise<void>,
): Promise<boolean> {
  return runSerializedSqlMutation(execSql, async (lockedExecSql) => {
    await ensureDocumentDeletionTables(lockedExecSql);
    return getClientSQLitePersistenceRuntime(lockedExecSql).transaction(
      async (tx) => {
        const existingDocument = await loadDocumentRecord(lockedExecSql, {
          appKind: DOCUMENTS_APP_KIND,
          localId: expectedRecord.id,
        });
        if (
          !existingDocument ||
          !sameCanonicalDocumentSecurityIdentity(
            existingDocument,
            expectedRecord,
          )
        ) {
          return false;
        }
        if (
          existingDocument.documentId &&
          (await hasAnotherDocumentAlias({
            documentId: existingDocument.documentId,
            localId: expectedRecord.id,
            tx,
          }))
        ) {
          return false;
        }
        await deleteStoredDocumentRows({
          existingDocumentId: existingDocument.documentId ?? null,
          localId: expectedRecord.id,
          lockedExecSql,
          tx,
        });
        await deleteClientProjection(lockedExecSql);
        return true;
      },
      { behavior: "immediate" },
    );
  });
}

export async function deleteStoredDocumentSideRowsIfAbsent(
  execSql: ExecSql,
  localId: string,
  expectedDocumentId: string | null,
  deleteClientProjection: (transactionExecSql: ExecSql) => Promise<void>,
): Promise<boolean> {
  return runSerializedSqlMutation(execSql, async (lockedExecSql) => {
    await ensureDocumentDeletionTables(lockedExecSql);
    return getClientSQLitePersistenceRuntime(lockedExecSql).transaction(
      async (tx) => {
        const existingDocument = await loadDocumentRecord(lockedExecSql, {
          appKind: DOCUMENTS_APP_KIND,
          localId,
        });
        if (existingDocument) return false;
        if (
          expectedDocumentId &&
          (await hasAnotherDocumentAlias({
            documentId: expectedDocumentId,
            localId,
            tx,
          }))
        ) {
          return false;
        }

        await deleteStoredDocumentRows({
          existingDocumentId: expectedDocumentId,
          localId,
          lockedExecSql,
          tx,
        });
        await deleteClientProjection(lockedExecSql);
        return true;
      },
      { behavior: "immediate" },
    );
  });
}

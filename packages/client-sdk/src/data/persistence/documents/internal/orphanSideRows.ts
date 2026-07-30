import { and, asc, eq, lt, notExists, type SQL } from "drizzle-orm";
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

// Crash residue gets a full day to outlive slow devices and wall-clock skew;
// canonical-row absence is necessary but never sufficient for fresh writes.
const DOCUMENT_ORPHAN_SWEEP_MIN_AGE_MS = 24 * 60 * 60 * 1000;

type DocumentSideLocalIdColumn =
  | typeof documentAttachmentBlobProjection.localId
  | typeof documentHistoryCheckpoints.localId
  | typeof documentHistoryUpdates.localId
  | typeof documentPendingAttachments.localId
  | typeof documentPendingUpdates.localId
  | typeof documentSyncFailures.localId;

function requirePredicate(predicate: SQL | undefined): SQL {
  if (!predicate) {
    throw new Error("Document orphan cleanup requires a SQL predicate");
  }
  return predicate;
}

function hasNoDocument(
  tx: ClientSQLiteTransaction,
  localId: DocumentSideLocalIdColumn,
): SQL {
  // Attachment tables have no app-kind discriminator because they are owned
  // exclusively by documents. If another app kind gains attachments, it must
  // get its own tables or add app-kind before sharing this orphan predicate.
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

export async function queueDocumentAttachmentBlobReclaims(input: {
  localWhere: SQL;
  pendingWhere: SQL;
  tx: ClientSQLiteTransaction;
}): Promise<void> {
  const { localWhere, pendingWhere, tx } = input;
  const [pendingAttachmentRows, localAttachmentRows] = await Promise.all([
    tx
      .select({ storageKey: documentPendingAttachments.storageKey })
      .from(documentPendingAttachments)
      .where(pendingWhere),
    tx
      .select({ storageKey: documentAttachmentBlobProjection.storageKey })
      .from(documentAttachmentBlobProjection)
      .where(localWhere),
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
}

/** Remove aged document side writes left behind without a canonical row. */
export async function deleteOrphanedDocumentSideRows(
  execSql: ExecSql,
  options: { now?: Date | undefined } = {},
): Promise<void> {
  const olderThan = new Date(
    (options.now?.getTime() ?? Date.now()) - DOCUMENT_ORPHAN_SWEEP_MIN_AGE_MS,
  ).toISOString();
  await getClientSQLitePersistenceRuntime(execSql).transaction(async (tx) => {
    const pendingAttachmentWhere = requirePredicate(
      and(
        lt(documentPendingAttachments.createdAt, olderThan),
        hasNoDocument(tx, documentPendingAttachments.localId),
      ),
    );
    const localAttachmentWhere = requirePredicate(
      and(
        lt(documentAttachmentBlobProjection.updatedAt, olderThan),
        hasNoDocument(tx, documentAttachmentBlobProjection.localId),
      ),
    );
    await queueDocumentAttachmentBlobReclaims({
      localWhere: localAttachmentWhere,
      pendingWhere: pendingAttachmentWhere,
      tx,
    });
    await tx
      .delete(documentHistoryCheckpoints)
      .where(
        and(
          eq(documentHistoryCheckpoints.appKind, DOCUMENTS_APP_KIND),
          lt(documentHistoryCheckpoints.updatedAt, olderThan),
          hasNoDocument(tx, documentHistoryCheckpoints.localId),
        ),
      )
      .run();
    await tx
      .delete(documentHistoryUpdates)
      .where(
        and(
          eq(documentHistoryUpdates.appKind, DOCUMENTS_APP_KIND),
          lt(documentHistoryUpdates.createdAt, olderThan),
          hasNoDocument(tx, documentHistoryUpdates.localId),
        ),
      )
      .run();
    await tx
      .delete(documentPendingUpdates)
      .where(
        and(
          eq(documentPendingUpdates.appKind, DOCUMENTS_APP_KIND),
          lt(documentPendingUpdates.createdAt, olderThan),
          hasNoDocument(tx, documentPendingUpdates.localId),
        ),
      )
      .run();
    await tx
      .delete(documentSyncFailures)
      .where(
        and(
          eq(documentSyncFailures.appKind, DOCUMENTS_APP_KIND),
          lt(documentSyncFailures.attemptedAt, olderThan),
          hasNoDocument(tx, documentSyncFailures.localId),
        ),
      )
      .run();
    await tx
      .delete(documentPendingAttachments)
      .where(pendingAttachmentWhere)
      .run();
    await tx
      .delete(documentAttachmentBlobProjection)
      .where(localAttachmentWhere)
      .run();
  });
}

export async function listDocumentOrphanBlobReclaims(
  execSql: ExecSql,
  limit: number,
): Promise<ReadonlyArray<string>> {
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const rows = await db
    .select({ storageKey: documentOrphanBlobReclaims.storageKey })
    .from(documentOrphanBlobReclaims)
    .orderBy(asc(documentOrphanBlobReclaims.storageKey))
    .limit(limit);
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

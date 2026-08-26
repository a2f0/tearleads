import { and, eq } from "drizzle-orm";
import { normalizeEffectiveAccessLevel } from "../../../accessLevel";
import { DEFAULT_DOCUMENT_KIND } from "../../../documents/documentConstants";
import { deriveStoredDocumentTitle } from "../../../documents/documentKinds";
import { serializeDocumentSyncPullContinuation } from "../../../documents/shared/pullContinuation";
import {
  type DocumentRecord as BaseDocumentRecord,
  type DocumentScope,
  documentRecordSelection,
  mapSelectedDocumentRecord,
} from "../../../sqlite/documentPersistence";
import {
  documentProjection,
  documentProjectionText,
  documents,
} from "../../../sqlite/schema";
import {
  type ClientSQLiteTransactionScope,
  getClientSQLitePersistenceRuntime,
} from "../../../sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../../../sqlite/sqlSchema";
import type { StoredDocumentRecord } from "../types";
import { DOCUMENTS_APP_KIND } from "./constants";
import {
  getProjectionDocumentKind,
  getProjectionText,
  getProjectionTitle,
  getProjectionUpdatedAt,
} from "./documentProjectionRows";

export function getDocumentScope(localId: string): DocumentScope {
  return {
    appKind: DOCUMENTS_APP_KIND,
    localId,
  };
}

export async function hasDocumentRow(
  execSql: ExecSql,
  localId: string,
): Promise<boolean> {
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const rows = await db
    .select({ localId: documents.localId })
    .from(documents)
    .where(
      and(
        eq(documents.appKind, DOCUMENTS_APP_KIND),
        eq(documents.localId, localId),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

async function loadDocumentRecordInTransaction(input: {
  localId: string;
  tx: ClientSQLiteTransactionScope;
}): Promise<BaseDocumentRecord | null> {
  const { localId, tx } = input;
  const rows = await tx
    .select(documentRecordSelection)
    .from(documents)
    .where(
      and(
        eq(documents.appKind, DOCUMENTS_APP_KIND),
        eq(documents.localId, localId),
      ),
    )
    .limit(1);

  return rows[0] ? mapSelectedDocumentRecord(rows[0]) : null;
}

function toDocumentRecordRow(input: {
  document: StoredDocumentRecord;
  updatedAt: string;
}) {
  const { document, updatedAt } = input;
  return {
    appKind: DOCUMENTS_APP_KIND,
    localId: document.id,
    documentId: document.documentId,
    ...(document.recoveryGeneration === undefined
      ? {}
      : { recoveryGeneration: document.recoveryGeneration }),
    snapshotEndVersion: document.snapshotEndVersion,
    accessEpoch: document.accessEpoch,
    accessStateHash: document.accessStateHash ?? null,
    effectiveAccessLevel: normalizeEffectiveAccessLevel(
      document.effectiveAccessLevel,
    ),
    lastCommitLsn: document.lastCommitLsn ?? null,
    documentManifestBundle: document.documentManifestBundle ?? null,
    contentKeyBundle: document.contentKeyBundle ?? null,
    documentKekTargets: document.documentKekTargets ?? null,
    // Only touch the outgoing-delta marker when the caller manages it. Callers
    // that leave it undefined (e.g. discovery upserts, registration bootstrap)
    // must not clobber a marker a device-first deferRemoteSync write persisted.
    ...(document.pendingBaseVersion === undefined
      ? {}
      : { pendingBaseVersion: document.pendingBaseVersion }),
    ...(document.pullContinuation === undefined
      ? {}
      : {
          pullContinuation: serializeDocumentSyncPullContinuation(
            document.pullContinuation,
          ),
        }),
    updatedAt,
  };
}

async function saveDocumentProjectionRows(input: {
  document: StoredDocumentRecord;
  tx: ClientSQLiteTransactionScope;
  updatedAt: string;
}): Promise<void> {
  const { document, tx, updatedAt } = input;
  const projectionRow = {
    localId: document.id,
    documentId: document.documentId,
    containerId: document.containerId,
    documentKind: document.documentKind ?? DEFAULT_DOCUMENT_KIND,
    title: document.title ?? deriveStoredDocumentTitle(document.text),
    updatedAt,
  };
  await tx
    .insert(documentProjection)
    .values(projectionRow)
    .onConflictDoUpdate({
      target: documentProjection.localId,
      set: projectionRow,
    })
    .run();

  const projectionTextRow = {
    localId: document.id,
    text: document.text,
  };
  await tx
    .insert(documentProjectionText)
    .values(projectionTextRow)
    .onConflictDoUpdate({
      target: documentProjectionText.localId,
      set: projectionTextRow,
    })
    .run();
}

export async function createDocumentRowsIfAbsent(input: {
  document: StoredDocumentRecord;
  tx: ClientSQLiteTransactionScope;
  updatedAt: string;
}): Promise<boolean> {
  const { document, tx, updatedAt } = input;
  const documentRow = toDocumentRecordRow({ document, updatedAt });
  const inserted = await tx
    .insert(documents)
    .values(documentRow)
    .onConflictDoNothing({
      target: [documents.appKind, documents.localId],
    })
    .returning({ localId: documents.localId });
  if (inserted.length === 0) {
    return false;
  }

  await saveDocumentProjectionRows(input);
  return true;
}

export async function saveDocumentRows(input: {
  document: StoredDocumentRecord;
  tx: ClientSQLiteTransactionScope;
  updatedAt: string;
}): Promise<void> {
  const { document, tx, updatedAt } = input;
  const documentRow = toDocumentRecordRow({ document, updatedAt });
  await tx
    .insert(documents)
    .values(documentRow)
    .onConflictDoUpdate({
      target: [documents.appKind, documents.localId],
      set: documentRow,
    })
    .run();
  await saveDocumentProjectionRows(input);
}

function didStoredDocumentContentChange(
  existing: Pick<
    StoredDocumentRecord,
    "documentKind" | "snapshotEndVersion" | "text" | "title"
  > | null,
  next: Pick<
    StoredDocumentRecord,
    "documentKind" | "snapshotEndVersion" | "text" | "title"
  >,
): boolean {
  return (
    existing === null ||
    existing.documentKind !== (next.documentKind ?? DEFAULT_DOCUMENT_KIND) ||
    existing.snapshotEndVersion !== next.snapshotEndVersion ||
    existing.text !== next.text ||
    existing.title !== (next.title ?? deriveStoredDocumentTitle(next.text))
  );
}

export async function resolveDocumentSaveTimestamp(input: {
  document: StoredDocumentRecord;
  options?: { updatedAt?: string } | undefined;
  tx: ClientSQLiteTransactionScope;
}): Promise<string> {
  const { document, options, tx } = input;
  if (options?.updatedAt) {
    return options.updatedAt;
  }

  const [existingRecord, projectionRows] = await Promise.all([
    loadDocumentRecordInTransaction({
      localId: document.id,
      tx,
    }),
    tx
      .select({
        documentKind: documentProjection.documentKind,
        text: documentProjectionText.text,
        title: documentProjection.title,
        updatedAt: documentProjection.updatedAt,
      })
      .from(documentProjection)
      .leftJoin(
        documentProjectionText,
        eq(documentProjectionText.localId, documentProjection.localId),
      )
      .where(eq(documentProjection.localId, document.id))
      .limit(1),
  ]);
  const existingProjection = projectionRows[0];
  const now = new Date().toISOString();
  return didStoredDocumentContentChange(
    existingRecord
      ? {
          documentKind: getProjectionDocumentKind(existingProjection),
          snapshotEndVersion: existingRecord.snapshotEndVersion,
          text: getProjectionText(existingProjection),
          title: getProjectionTitle(existingProjection),
        }
      : null,
    document,
  )
    ? now
    : getProjectionUpdatedAt(existingProjection) || now;
}

import { and, eq } from "drizzle-orm";
import { normalizeEffectiveAccessLevel } from "../../../accessLevel";
import { DEFAULT_DOCUMENT_KIND } from "../../../documents/documentConstants";
import {
  type DocumentRecord as BaseDocumentRecord,
  type DocumentScope,
  mapSelectedDocumentRecord,
} from "../../../sqlite/documentPersistence";
import {
  documentProjection,
  documentProjectionText,
  documents,
} from "../../../sqlite/schema";
import type { ClientSQLiteTransaction } from "../../../sqlite/sqlitePersistenceRuntime";
import type { StoredDocumentRecord } from "../types";
import { DOCUMENTS_APP_KIND } from "./constants";
import {
  deriveDocumentTitle,
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

async function loadDocumentRecordInTransaction(input: {
  localId: string;
  tx: ClientSQLiteTransaction;
}): Promise<BaseDocumentRecord | null> {
  const { localId, tx } = input;
  const rows = await tx
    .select({
      id: documents.localId,
      documentId: documents.documentId,
      snapshotEndVersion: documents.snapshotEndVersion,
      accessEpoch: documents.accessEpoch,
      accessStateHash: documents.accessStateHash,
      effectiveAccessLevel: documents.effectiveAccessLevel,
      lastCommitLsn: documents.lastCommitLsn,
      documentManifestBundle: documents.documentManifestBundle,
      contentKeyBundle: documents.contentKeyBundle,
      documentKekTargets: documents.documentKekTargets,
      pendingBaseVersion: documents.pendingBaseVersion,
    })
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
    updatedAt,
  };
}

export async function saveDocumentRows(input: {
  document: StoredDocumentRecord;
  tx: ClientSQLiteTransaction;
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

  const projectionRow = {
    localId: document.id,
    documentId: document.documentId,
    containerId: document.containerId,
    documentKind: document.documentKind ?? DEFAULT_DOCUMENT_KIND,
    title: document.title ?? deriveDocumentTitle(document.text),
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
    existing.title !== (next.title ?? deriveDocumentTitle(next.text))
  );
}

export async function resolveDocumentSaveTimestamp(input: {
  document: StoredDocumentRecord;
  options?: { updatedAt?: string } | undefined;
  tx: ClientSQLiteTransaction;
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

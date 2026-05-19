import { and, eq } from "drizzle-orm";
import { getClientDatabaseRuntime } from "./clientDatabaseRuntime";
import type {
  DocumentRecord,
  DocumentScope,
  SelectedDocumentRecordRow,
} from "./documentPersistenceTypes";
import { documents } from "./schema";
import type { ExecSql } from "./sqlSchema";

export function mapSelectedDocumentRecord(
  row: SelectedDocumentRecordRow,
): DocumentRecord {
  const record: DocumentRecord = {
    id: row.id,
    documentId: row.documentId,
    loroSnapshot: row.loroSnapshot,
    accessEpoch: row.accessEpoch,
    lastCommitLsn: row.lastCommitLsn,
    contentKeyBundle: row.contentKeyBundle,
    documentKekTargets: row.documentKekTargets,
    documentManifestBundle: row.documentManifestBundle,
  };

  if (row.accessStateHash !== null) {
    record.accessStateHash = row.accessStateHash;
  }

  return record;
}

function toDocumentRow(input: {
  record: DocumentRecord;
  scope: DocumentScope;
  updatedAt: string;
}) {
  const { record, scope, updatedAt } = input;
  return {
    appKind: scope.appKind,
    localId: scope.localId,
    documentId: record.documentId,
    loroSnapshot: record.loroSnapshot,
    accessEpoch: record.accessEpoch,
    accessStateHash: record.accessStateHash ?? null,
    lastCommitLsn: record.lastCommitLsn ?? null,
    documentManifestBundle: record.documentManifestBundle ?? null,
    contentKeyBundle: record.contentKeyBundle ?? null,
    documentKekTargets: record.documentKekTargets ?? null,
    updatedAt,
  };
}

export async function loadDocumentRecord(
  execSql: ExecSql,
  scope: DocumentScope,
): Promise<DocumentRecord | null> {
  const { db } = getClientDatabaseRuntime(execSql);
  const rows = await db
    .select({
      id: documents.localId,
      documentId: documents.documentId,
      loroSnapshot: documents.loroSnapshot,
      accessEpoch: documents.accessEpoch,
      accessStateHash: documents.accessStateHash,
      lastCommitLsn: documents.lastCommitLsn,
      documentManifestBundle: documents.documentManifestBundle,
      contentKeyBundle: documents.contentKeyBundle,
      documentKekTargets: documents.documentKekTargets,
    })
    .from(documents)
    .where(
      and(
        eq(documents.appKind, scope.appKind),
        eq(documents.localId, scope.localId),
      ),
    )
    .limit(1);

  return rows[0] ? mapSelectedDocumentRecord(rows[0]) : null;
}

export async function findLocalIdByDocumentId(
  execSql: ExecSql,
  appKind: string,
  documentId: string,
): Promise<string | null> {
  const { db } = getClientDatabaseRuntime(execSql);
  const rows = await db
    .select({ localId: documents.localId })
    .from(documents)
    .where(
      and(eq(documents.appKind, appKind), eq(documents.documentId, documentId)),
    )
    .limit(1);

  return rows[0]?.localId ?? null;
}

export async function saveDocumentRecord(
  execSql: ExecSql,
  scope: DocumentScope,
  record: DocumentRecord,
  updatedAt: string,
): Promise<void> {
  const nextRow = toDocumentRow({ record, scope, updatedAt });

  await getClientDatabaseRuntime(execSql).runMutation(async (db) => {
    await db
      .insert(documents)
      .values(nextRow)
      .onConflictDoUpdate({
        target: [documents.appKind, documents.localId],
        set: nextRow,
      })
      .run();
  });
}

export async function deleteDocumentRecord(
  execSql: ExecSql,
  scope: DocumentScope,
): Promise<void> {
  await getClientDatabaseRuntime(execSql).runMutation(async (db) => {
    await db
      .delete(documents)
      .where(
        and(
          eq(documents.appKind, scope.appKind),
          eq(documents.localId, scope.localId),
        ),
      )
      .run();
  });
}

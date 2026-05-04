import { and, asc, eq } from "drizzle-orm";
import { getAppDatabaseRuntime } from "./appDatabaseRuntime";
import { documentPendingUpdates, documents, documentTables } from "./schema";
import type { SqlRow } from "./sqlSchema";
import { type ExecSql, ensureSqlTables, readSqlRowValue } from "./sqlSchema";

export interface DocumentRecord {
  id: string;
  documentId: string | null;
  loroSnapshot: string;
  accessEpoch: number;
  accessStateHash?: string | null;
  lastCommitLsn?: string | null;
  contentKeyBundle?: string | null;
  documentKekTargets?: string | null;
  documentManifestBundle?: string | null;
}

export interface PendingUpdateFields {
  updateData: string;
  partialStartVersionVector: string;
  partialEndVersionVector: string;
  sourceVersionVector?: string | null;
}

export interface PendingUpdateRecord extends PendingUpdateFields {
  id: string;
}

export interface DocumentScope {
  appKind: string;
  localId: string;
}

export async function ensureDocumentTables(execSql: ExecSql): Promise<void> {
  await ensureSqlTables(execSql, documentTables);
}

export function parseDocumentRecord(row: SqlRow): DocumentRecord {
  const id = readSqlRowValue(row, "id");
  const documentId = readSqlRowValue(row, "document_id");
  const loroSnapshot = readSqlRowValue(row, "loro_snapshot");
  const accessEpoch = readSqlRowValue(row, "access_epoch");
  const accessStateHash = readSqlRowValue(row, "access_state_hash");
  const lastCommitLsn = readSqlRowValue(row, "last_commit_lsn");
  const contentKeyBundle = readSqlRowValue(row, "content_key_bundle");
  const documentKekTargets = readSqlRowValue(row, "document_kek_targets");
  const documentManifestBundle = readSqlRowValue(
    row,
    "document_manifest_bundle",
  );

  const record: DocumentRecord = {
    id: String(id ?? ""),
    documentId: documentId === null ? null : String(documentId),
    loroSnapshot: String(loroSnapshot ?? ""),
    accessEpoch: typeof accessEpoch === "number" ? accessEpoch : 1,
    lastCommitLsn:
      lastCommitLsn === null || lastCommitLsn === undefined
        ? null
        : String(lastCommitLsn),
    contentKeyBundle:
      contentKeyBundle === null || contentKeyBundle === undefined
        ? null
        : String(contentKeyBundle),
    documentKekTargets:
      documentKekTargets === null || documentKekTargets === undefined
        ? null
        : String(documentKekTargets),
    documentManifestBundle:
      documentManifestBundle === null || documentManifestBundle === undefined
        ? null
        : String(documentManifestBundle),
  };

  if (accessStateHash !== null && accessStateHash !== undefined) {
    record.accessStateHash = String(accessStateHash);
  }

  return record;
}

interface SelectedDocumentRecordRow {
  id: string;
  documentId: string | null;
  loroSnapshot: string;
  accessEpoch: number;
  accessStateHash: string | null;
  lastCommitLsn: string | null;
  contentKeyBundle: string | null;
  documentKekTargets: string | null;
  documentManifestBundle: string | null;
}

function mapSelectedDocumentRecord(
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

interface SelectedPendingUpdateRow {
  id: string | null;
  updateData: string;
  partialStartVersionVector: string;
  partialEndVersionVector: string;
  sourceVersionVector: string | null;
}

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

export async function loadDocumentRecord(
  execSql: ExecSql,
  scope: DocumentScope,
): Promise<DocumentRecord | null> {
  const { db } = getAppDatabaseRuntime(execSql);
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
  const { db } = getAppDatabaseRuntime(execSql);
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
  const nextRow = {
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

  await getAppDatabaseRuntime(execSql).runMutation(async (db) => {
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
  await getAppDatabaseRuntime(execSql).runMutation(async (db) => {
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

export async function listDocumentPendingUpdates(
  execSql: ExecSql,
  scope: DocumentScope,
): Promise<PendingUpdateRecord[]> {
  const { db } = getAppDatabaseRuntime(execSql);
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
    .orderBy(asc(documentPendingUpdates.createdAt));

  return rows.map(mapSelectedPendingUpdate);
}

export async function enqueueDocumentPendingUpdate(
  execSql: ExecSql,
  scope: DocumentScope,
  pendingUpdate: PendingUpdateFields,
): Promise<void> {
  await getAppDatabaseRuntime(execSql).runMutation(async (db) => {
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
  await getAppDatabaseRuntime(execSql).runMutation(async (db) => {
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
  await getAppDatabaseRuntime(execSql).runMutation(async (db) => {
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

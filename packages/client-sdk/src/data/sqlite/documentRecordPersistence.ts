import { and, eq } from "drizzle-orm";
import {
  DEFAULT_EFFECTIVE_ACCESS_LEVEL,
  normalizeEffectiveAccessLevel,
} from "../accessLevel";
import type {
  DocumentRecord,
  DocumentScope,
  SelectedDocumentRecordRow,
} from "./documentPersistenceTypes";
import { documents } from "./schema";
import { getClientSQLitePersistenceRuntime } from "./sqlitePersistenceRuntime";
import type { ExecSql } from "./sqlSchema";

export function mapSelectedDocumentRecord(
  row: SelectedDocumentRecordRow,
): DocumentRecord {
  const record: DocumentRecord = {
    id: row.id,
    documentId: row.documentId,
    loroSnapshot: row.loroSnapshot,
    accessEpoch: row.accessEpoch,
    effectiveAccessLevel: normalizeEffectiveAccessLevel(
      row.effectiveAccessLevel,
    ),
    lastCommitLsn: row.lastCommitLsn,
    contentKeyBundle: row.contentKeyBundle,
    documentKekTargets: row.documentKekTargets,
    documentManifestBundle: row.documentManifestBundle,
  };

  if (row.accessStateHash !== null) {
    record.accessStateHash = row.accessStateHash;
  }

  // Only surface the marker when one was persisted, so a row that never stored
  // one keeps its prior shape (and init falls through to seeding it).
  if (row.pendingBaseVersion !== null) {
    record.pendingBaseVersion = row.pendingBaseVersion;
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
    effectiveAccessLevel:
      record.effectiveAccessLevel ?? DEFAULT_EFFECTIVE_ACCESS_LEVEL,
    lastCommitLsn: record.lastCommitLsn ?? null,
    documentManifestBundle: record.documentManifestBundle ?? null,
    contentKeyBundle: record.contentKeyBundle ?? null,
    documentKekTargets: record.documentKekTargets ?? null,
    // Only touch the outgoing-delta marker when the caller manages it. Callers
    // that leave it undefined (e.g. discovery upserts) must not clobber a marker
    // a device-first deferRemoteSync write persisted on this row.
    ...(record.pendingBaseVersion === undefined
      ? {}
      : { pendingBaseVersion: record.pendingBaseVersion }),
    updatedAt,
  };
}

export async function loadDocumentRecord(
  execSql: ExecSql,
  scope: DocumentScope,
): Promise<DocumentRecord | null> {
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const rows = await db
    .select({
      id: documents.localId,
      documentId: documents.documentId,
      loroSnapshot: documents.loroSnapshot,
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
  const { db } = getClientSQLitePersistenceRuntime(execSql);
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

  await getClientSQLitePersistenceRuntime(execSql).runMutation(async (db) => {
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
  await getClientSQLitePersistenceRuntime(execSql).runMutation(async (db) => {
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

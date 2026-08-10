import { and, eq } from "drizzle-orm";
import { normalizeEffectiveAccessLevel } from "../accessLevel";
import type {
  DocumentRecord,
  DocumentScope,
  SelectedDocumentRecordRow,
} from "./documentPersistenceTypes";
import { documents } from "./schema";
import { getClientSQLitePersistenceRuntime } from "./sqlitePersistenceRuntime";
import type { ExecSql } from "./sqlSchema";

/**
 * The ONE select shape for a full documents-row record: every reader that
 * feeds mapSelectedDocumentRecord spreads this, so a new record column cannot
 * silently miss one of them.
 */
export const documentRecordSelection = {
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
};

export function mapSelectedDocumentRecord(
  row: SelectedDocumentRecordRow,
): DocumentRecord {
  const record: DocumentRecord = {
    id: row.id,
    documentId: row.documentId,
    snapshotEndVersion: row.snapshotEndVersion,
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

export async function loadDocumentRecord(
  execSql: ExecSql,
  scope: DocumentScope,
): Promise<DocumentRecord | null> {
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const rows = await db
    .select(documentRecordSelection)
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

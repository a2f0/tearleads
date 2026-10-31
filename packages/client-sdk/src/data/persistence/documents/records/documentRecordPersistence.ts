import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { deserializeDocumentSyncPullContinuation } from "../../../documents/shared/sync/pullContinuation";
import { normalizeEffectiveAccessLevel } from "../../../keying/accessLevel";
import { documentHistoryUpdates, documents } from "../../../sqlite/schema";
import { sqliteRowsPerStatement } from "../../../sqlite/sqliteBindBudget";
import { getClientSQLitePersistenceRuntime } from "../../../sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../../../sqlite/sqlSchema";
import type {
  DocumentRecord,
  DocumentScope,
  SelectedDocumentRecordRow,
} from "./documentPersistenceTypes";

/**
 * The ONE select shape for a full documents-row record: every reader that
 * feeds mapSelectedDocumentRecord spreads this, so a new record column cannot
 * silently miss one of them.
 */
export const documentRecordSelection = {
  id: documents.localId,
  documentId: documents.documentId,
  recoveryGeneration: documents.recoveryGeneration,
  recoveryDocumentId: documents.recoveryDocumentId,
  snapshotEndVersion: documents.snapshotEndVersion,
  accessEpoch: documents.accessEpoch,
  accessStateHash: documents.accessStateHash,
  effectiveAccessLevel: documents.effectiveAccessLevel,
  lastCommitLsn: documents.lastCommitLsn,
  documentManifestBundle: documents.documentManifestBundle,
  contentKeyBundle: documents.contentKeyBundle,
  documentKekTargets: documents.documentKekTargets,
  pendingBaseVersion: documents.pendingBaseVersion,
  pullContinuation: documents.pullContinuation,
};

export function mapSelectedDocumentRecord(
  row: SelectedDocumentRecordRow,
): DocumentRecord {
  const record: DocumentRecord = {
    id: row.id,
    documentId: row.documentId,
    recoveryGeneration: row.recoveryGeneration,
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

  if (row.recoveryDocumentId !== null) {
    record.recoveryDocumentId = row.recoveryDocumentId;
  }

  // Only surface the marker when one was persisted, so a row that never stored
  // one keeps its prior shape (and init falls through to seeding it).
  if (row.pendingBaseVersion !== null) {
    record.pendingBaseVersion = row.pendingBaseVersion;
  }

  const pullContinuation = deserializeDocumentSyncPullContinuation(
    row.pullContinuation,
  );
  if (pullContinuation !== null) {
    record.pullContinuation = pullContinuation;
  } else if (row.pullContinuation !== null) {
    record.pullContinuationRecoveryRequired = true;
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

/**
 * Duplicate remote identities can survive an interrupted local adoption, so
 * the row to use for a document id is chosen by this order: queued or
 * deferred edits first, then a stable fallback.
 */
function localIdPreferenceOrder() {
  const hasPendingUpdates = sql<number>`EXISTS (
    SELECT 1
    FROM ${documentHistoryUpdates}
    WHERE ${documentHistoryUpdates.appKind} = ${documents.appKind}
      AND ${documentHistoryUpdates.localId} = ${documents.localId}
      AND ${documentHistoryUpdates.updateId} IS NOT NULL
  )`;
  const hasPendingLocalWork = sql<number>`(
    ${hasPendingUpdates}
    OR (
      ${documents.pendingBaseVersion} IS NOT NULL
      AND ${documents.pendingBaseVersion} <> ${documents.snapshotEndVersion}
    )
  )`;
  return [
    desc(hasPendingLocalWork),
    desc(documents.updatedAt),
    desc(documents.localId),
  ];
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
    .orderBy(...localIdPreferenceOrder())
    .limit(1);

  return rows[0]?.localId ?? null;
}

/**
 * `findLocalIdByDocumentId` for many document ids: one read per chunk, in the
 * same preference order, keeping the first row per document id.
 */
export async function findLocalIdsByDocumentIds(
  execSql: ExecSql,
  appKind: string,
  documentIds: ReadonlyArray<string>,
): Promise<Map<string, string>> {
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const localIds = new Map<string, string>();
  const unique = Array.from(new Set(documentIds));
  // One bind for the app kind; the rest carry document ids.
  const chunkSize = sqliteRowsPerStatement(1, 1);
  for (let offset = 0; offset < unique.length; offset += chunkSize) {
    const rows = await db
      .select({ documentId: documents.documentId, localId: documents.localId })
      .from(documents)
      .where(
        and(
          eq(documents.appKind, appKind),
          inArray(
            documents.documentId,
            unique.slice(offset, offset + chunkSize),
          ),
        ),
      )
      .orderBy(...localIdPreferenceOrder());
    for (const row of rows) {
      if (row.documentId !== null && !localIds.has(row.documentId)) {
        localIds.set(row.documentId, row.localId);
      }
    }
  }
  return localIds;
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

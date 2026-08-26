import { and, desc, eq, sql } from "drizzle-orm";
import { normalizeEffectiveAccessLevel } from "../accessLevel";
import { deserializeDocumentSyncPullContinuation } from "../documents/shared/pullContinuation";
import type {
  DocumentRecord,
  DocumentScope,
  SelectedDocumentRecordRow,
} from "./documentPersistenceTypes";
import { documentPendingUpdates, documents } from "./schema";
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
  recoveryGeneration: documents.recoveryGeneration,
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

export async function findLocalIdByDocumentId(
  execSql: ExecSql,
  appKind: string,
  documentId: string,
): Promise<string | null> {
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const hasPendingUpdates = sql<number>`EXISTS (
    SELECT 1
    FROM ${documentPendingUpdates}
    WHERE ${documentPendingUpdates.appKind} = ${documents.appKind}
      AND ${documentPendingUpdates.localId} = ${documents.localId}
  )`;
  const hasPendingLocalWork = sql<number>`(
    ${hasPendingUpdates}
    OR (
      ${documents.pendingBaseVersion} IS NOT NULL
      AND ${documents.pendingBaseVersion} <> ${documents.snapshotEndVersion}
    )
  )`;
  const rows = await db
    .select({ localId: documents.localId })
    .from(documents)
    .where(
      and(eq(documents.appKind, appKind), eq(documents.documentId, documentId)),
    )
    // Duplicate remote identities can survive an interrupted local adoption.
    // Preserve queued or deferred edits, then make the fallback stable.
    .orderBy(
      desc(hasPendingLocalWork),
      desc(documents.updatedAt),
      desc(documents.localId),
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

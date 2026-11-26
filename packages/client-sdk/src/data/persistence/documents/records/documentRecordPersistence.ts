import { desc, sql } from "drizzle-orm";
import { deserializeDocumentSyncPullContinuation } from "../../../documents/shared/sync/pullContinuation";
import { normalizeEffectiveAccessLevel } from "../../../keying/accessLevel";
import {
  documentHistoryUpdates,
  documents,
} from "../../../sqlite/schema/documentRecordSchema";
import type {
  DocumentRecord,
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
  peerSalt: documents.peerSalt,
  committedVersion: documents.committedVersion,
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

  if (row.peerSalt !== null) {
    record.peerSalt = row.peerSalt;
  }

  if (row.committedVersion !== null) {
    record.committedVersion = row.committedVersion;
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

/**
 * Duplicate remote identities can survive an interrupted local adoption, so
 * the row to use for a document id is chosen by this order: queued or
 * deferred edits first, then a stable fallback.
 */
export function localIdPreferenceOrder() {
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

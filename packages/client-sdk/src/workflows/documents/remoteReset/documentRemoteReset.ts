import { and, eq, inArray, or, sql } from "drizzle-orm";
import {
  queuedUpdateRow,
  unqueueDocumentScopesInTransaction,
} from "../../../data/persistence/documents/records/documentPendingUpdatePersistence";
import { CLEARED_DOCUMENT_SYNC_FAILURE } from "../../../data/persistence/documents/records/documentSyncFailurePersistence";
import {
  documentAttachmentBlobProjection,
  documentHistoryUpdates,
  documentPendingAttachments,
  documentProjection,
  documents,
} from "../../../data/sqlite/schema";
import { remoteResetBatches } from "../../../data/sqlite/sqliteBindBudget";
import type { ClientSQLiteTransactionScope } from "../../../data/sqlite/sqlitePersistenceRuntime";
import { clearResetPendingAttachments } from "./remoteResetAttachments";
import type {
  ResetAttachmentUpload,
  ResetDocumentScope,
  ResetDocumentUpdate,
} from "./remoteResetPlans";

// Document Store's part of a remote reset. The sync remote reset calls these in
// one transaction: it forgets what the server held for the organization's
// documents, strips their server identity, and queues their local history and
// attachments to be published again.
export { clearDocumentDiscoveryEvidenceOnRemoteReset } from "../../../data/persistence/documents/documentDiscoveryReset";
export {
  buildResetPlans,
  type ResetAttachmentUpload,
  type ResetDocumentUpdate,
} from "./remoteResetPlans";

export interface ResetDocumentRow extends ResetDocumentScope {
  readonly documentId: string | null;
  readonly recoveryDocumentId: string | null;
}

interface DocumentPlacementRow {
  readonly containerId: string;
  readonly documentId: string;
}

/**
 * The documents a reset covers: metadata documents of its folders, documents
 * projected into the organization or its folders, and documents placed in them.
 */
export async function loadDocumentResetScope(input: {
  containerIds: readonly string[];
  organizationId: string;
  placementRows: readonly DocumentPlacementRow[];
  tx: ClientSQLiteTransactionScope;
}): Promise<{
  documentLocalIds: string[];
  documentRows: ResetDocumentRow[];
  oldDocumentIds: string[];
}> {
  const { organizationId, tx } = input;
  const containerIdSet = new Set(input.containerIds);
  const [allDocuments, projectionRows] = await Promise.all([
    tx
      .select({
        appKind: documents.appKind,
        documentId: documents.documentId,
        localId: documents.localId,
        recoveryDocumentId: documents.recoveryDocumentId,
      })
      .from(documents),
    tx.select().from(documentProjection),
  ]);
  const linkedDocumentIds = new Set(
    input.placementRows
      .filter((row) => containerIdSet.has(row.containerId))
      .map((row) => row.documentId),
  );
  const projectedLocalIds = new Set(
    projectionRows
      .filter(
        (row) =>
          (row.containerId !== null && containerIdSet.has(row.containerId)) ||
          row.organizationId === organizationId ||
          (row.documentId !== null && linkedDocumentIds.has(row.documentId)),
      )
      .flatMap((row) => (row.localId ? [row.localId] : [])),
  );
  const documentRows = allDocuments.filter(
    (row) =>
      (row.appKind === "container-metadata" &&
        containerIdSet.has(row.localId)) ||
      (row.appKind === "documents" && projectedLocalIds.has(row.localId)) ||
      (row.documentId !== null && linkedDocumentIds.has(row.documentId)),
  );
  return {
    documentLocalIds: [
      ...new Set(
        documentRows
          .filter((row) => row.appKind === "documents")
          .map((row) => row.localId),
      ),
    ],
    documentRows,
    oldDocumentIds: [
      ...new Set(
        documentRows.flatMap((row) => (row.documentId ? [row.documentId] : [])),
      ),
    ],
  };
}

/** Clears pending attachments (keeping re-queued bytes) and queued updates. */
export async function clearDocumentRowsForRemoteReset(input: {
  attachmentUploads: readonly ResetAttachmentUpload[];
  documentLocalIds: readonly string[];
  documentRows: readonly ResetDocumentRow[];
  tx: ClientSQLiteTransactionScope;
}): Promise<void> {
  const { tx } = input;
  await clearResetPendingAttachments({
    attachmentUploads: input.attachmentUploads,
    documentLocalIds: input.documentLocalIds,
    tx,
  });
  // Sync failures clear with the document columns in resetDocumentServerIdentity.
  for (const documentBatch of remoteResetBatches(input.documentRows)) {
    await unqueueDocumentScopesInTransaction(tx, documentBatch);
  }
}

/**
 * Drops each document's server id, keys, manifest, and sync position, keeping
 * the old id for recovery, and moves its projection to `organizationId`.
 */
export async function resetDocumentServerIdentity(input: {
  documentLocalIds: readonly string[];
  documentRows: readonly ResetDocumentRow[];
  now: string;
  organizationId: string;
  tx: ClientSQLiteTransactionScope;
}): Promise<void> {
  const { now, tx } = input;
  const localIdsByAppKind = new Map<string, string[]>();
  for (const row of input.documentRows) {
    const localIds = localIdsByAppKind.get(row.appKind);
    if (localIds) localIds.push(row.localId);
    else localIdsByAppKind.set(row.appKind, [row.localId]);
  }
  // One update per batch: SQLite evaluates every SET value against the old
  // row, so COALESCE keeps the id being cleared (or the earlier recovery id)
  // per row; no earlier reset step writes either column.
  for (const [appKind, localIds] of localIdsByAppKind) {
    for (const localIdBatch of remoteResetBatches(localIds)) {
      await tx
        .update(documents)
        .set({
          accessEpoch: 1,
          accessStateHash: null,
          contentKeyBundle: null,
          documentId: null,
          documentKekTargets: null,
          documentManifestBundle: null,
          lastCommitLsn: null,
          pullContinuation: null,
          recoveryDocumentId: sql`coalesce(${documents.documentId}, ${documents.recoveryDocumentId})`,
          ...CLEARED_DOCUMENT_SYNC_FAILURE,
          updatedAt: now,
        })
        .where(
          and(
            eq(documents.appKind, appKind),
            inArray(documents.localId, localIdBatch),
          ),
        )
        .run();
    }
  }
  for (const localIdBatch of remoteResetBatches(input.documentLocalIds)) {
    await tx
      .update(documentProjection)
      .set({
        documentId: null,
        organizationId: input.organizationId,
      })
      .where(inArray(documentProjection.localId, localIdBatch))
      .run();
  }
}

/** Queues each document's rebuilt local history as one outbox update. */
export async function queueDocumentRepublishForRemoteReset(input: {
  documentUpdates: readonly ResetDocumentUpdate[];
  now: string;
  tx: ClientSQLiteTransactionScope;
}): Promise<void> {
  for (const updateBatch of remoteResetBatches(input.documentUpdates)) {
    await input.tx
      .insert(documentHistoryUpdates)
      .values(
        updateBatch.map((update) =>
          queuedUpdateRow({
            createdAt: input.now,
            origin: "outbox",
            pendingUpdate: update,
            scope: update,
            updateId: crypto.randomUUID(),
          }),
        ),
      )
      .run();
  }
}

/** Queues the attachments the documents still advertise for upload. */
export async function queueAttachmentReuploadsForRemoteReset(input: {
  attachmentUploads: readonly ResetAttachmentUpload[];
  now: string;
  tx: ClientSQLiteTransactionScope;
}): Promise<void> {
  for (const attachmentBatch of remoteResetBatches(input.attachmentUploads)) {
    await input.tx
      .insert(documentPendingAttachments)
      .values(
        attachmentBatch.map((attachment) => ({
          ...attachment,
          createdAt: input.now,
        })),
      )
      .run();
    await input.tx
      .delete(documentAttachmentBlobProjection)
      .where(
        or(
          ...attachmentBatch.map((attachment) =>
            and(
              eq(documentAttachmentBlobProjection.localId, attachment.localId),
              eq(documentAttachmentBlobProjection.slotId, attachment.slotId),
            ),
          ),
        ),
      )
      .run();
  }
}

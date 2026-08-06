import { and, eq, isNull } from "drizzle-orm";
import {
  appendDocumentHistoryUpdates,
  listDocumentHistoryTailEntries,
  loadDocumentHistoryRestoreState,
  readDocumentHistoryTailSize,
  replaceDocumentHistoryCheckpoint,
} from "../../../sqlite/documentHistoryPersistence";
import {
  deleteDocumentPendingUpdate,
  deleteDocumentPendingUpdates,
  enqueueDocumentPendingUpdateWithHistory,
  listDocumentPendingUpdates,
  rekeyDocumentPendingUpdate,
} from "../../../sqlite/documentPersistence";
import {
  documentAttachmentBlobProjection,
  documentPendingAttachments,
} from "../../../sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../../sqlite/sqlitePersistenceRuntime";
import { runSerializedSqlMutation } from "../../../sqlite/sqlSchema";
import type { DocumentsPersistence } from "../types";
import {
  buildPendingAttachmentRow,
  mapLocalAttachmentRecord,
  mapPendingAttachmentRecord,
} from "./attachmentRows";
import { getDocumentScope } from "./documentRows";

type DocumentSyncQueuePersistence = Pick<
  DocumentsPersistence,
  | "listPendingUpdates"
  | "rekeyPendingUpdate"
  | "listPendingAttachments"
  | "listLocalAttachments"
  | "appendHistoryUpdates"
  | "loadHistoryRestoreState"
  | "readHistoryTailSize"
  | "listHistoryTailEntries"
  | "replaceHistoryCheckpoint"
  | "enqueuePendingUpdate"
  | "saveLocalAttachment"
  | "deleteLocalAttachment"
  | "markLocalAttachmentDetached"
  | "savePendingAttachment"
  | "deletePendingUpdate"
  | "deletePendingUpdates"
  | "deletePendingAttachment"
  | "deletePendingAttachments"
>;

export const documentSyncQueuePersistence: DocumentSyncQueuePersistence = {
  async listPendingUpdates(execSql, localId) {
    return listDocumentPendingUpdates(execSql, getDocumentScope(localId));
  },
  async rekeyPendingUpdate(execSql, id) {
    return rekeyDocumentPendingUpdate(execSql, id);
  },
  async listPendingAttachments(execSql, localId) {
    const { db } = getClientSQLitePersistenceRuntime(execSql);
    const rows = await db
      .select({
        localId: documentPendingAttachments.localId,
        slotId: documentPendingAttachments.slotId,
        name: documentPendingAttachments.name,
        mimeType: documentPendingAttachments.mimeType,
        storageKey: documentPendingAttachments.storageKey,
        byteLength: documentPendingAttachments.byteLength,
        uploadBlobId: documentPendingAttachments.uploadBlobId,
        uploadContentKey: documentPendingAttachments.uploadContentKey,
        uploadIv: documentPendingAttachments.uploadIv,
        uploadContentKeyEpoch: documentPendingAttachments.uploadContentKeyEpoch,
        uploadPartSize: documentPendingAttachments.uploadPartSize,
        uploadPlaintextSha256: documentPendingAttachments.uploadPlaintextSha256,
        uploadStageId: documentPendingAttachments.uploadStageId,
      })
      .from(documentPendingAttachments)
      .where(eq(documentPendingAttachments.localId, localId))
      .orderBy(
        documentPendingAttachments.createdAt,
        documentPendingAttachments.slotId,
      );

    return rows.map(mapPendingAttachmentRecord);
  },
  // Detached rows are included on purpose: they are the durable markers the
  // next sync uses to detach the remote binding, so a restart has to restore
  // them alongside the live slots.
  async listLocalAttachments(execSql, localId) {
    const { db } = getClientSQLitePersistenceRuntime(execSql);
    const rows = await db
      .select({
        localId: documentAttachmentBlobProjection.localId,
        slotId: documentAttachmentBlobProjection.slotId,
        blobId: documentAttachmentBlobProjection.blobId,
        storageKey: documentAttachmentBlobProjection.storageKey,
        mimeType: documentAttachmentBlobProjection.mimeType,
        byteLength: documentAttachmentBlobProjection.byteLength,
        detachedAt: documentAttachmentBlobProjection.detachedAt,
      })
      .from(documentAttachmentBlobProjection)
      .where(eq(documentAttachmentBlobProjection.localId, localId));

    return rows.map(mapLocalAttachmentRecord);
  },
  async appendHistoryUpdates(execSql, input) {
    await appendDocumentHistoryUpdates(
      execSql,
      getDocumentScope(input.localId),
      input.updates,
      input.origin,
    );
  },
  async loadHistoryRestoreState(execSql, localId) {
    return loadDocumentHistoryRestoreState(execSql, getDocumentScope(localId));
  },
  async readHistoryTailSize(execSql, localId) {
    return readDocumentHistoryTailSize(execSql, getDocumentScope(localId));
  },
  async listHistoryTailEntries(execSql, localId) {
    return listDocumentHistoryTailEntries(execSql, getDocumentScope(localId));
  },
  async replaceHistoryCheckpoint(execSql, input) {
    await replaceDocumentHistoryCheckpoint(
      execSql,
      getDocumentScope(input.localId),
      {
        coveredTailIds: input.coveredTailIds,
        endVersionVector: input.endVersionVector,
        ...(input.force === undefined ? {} : { force: input.force }),
        snapshot: input.snapshot,
        ...(input.stillCurrent === undefined
          ? {}
          : { stillCurrent: input.stillCurrent }),
      },
    );
  },
  async enqueuePendingUpdate(execSql, pendingUpdate) {
    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      await enqueueDocumentPendingUpdateWithHistory(
        lockedExecSql,
        getDocumentScope(pendingUpdate.localId),
        pendingUpdate,
      );
    });
  },
  async saveLocalAttachment(execSql, attachment) {
    const updatedAt = new Date().toISOString();

    await getClientSQLitePersistenceRuntime(execSql).runMutation(async (db) => {
      const attachmentRow = {
        localId: attachment.localId,
        slotId: attachment.slotId,
        blobId: attachment.blobId,
        storageKey: attachment.storageKey,
        mimeType: attachment.mimeType,
        byteLength: attachment.byteLength,
        updatedAt,
        // Written on every save so re-filling a slot clears a stale detach
        // marker instead of inheriting it from the row it replaces.
        detachedAt: attachment.detachedAt,
      };
      await db
        .insert(documentAttachmentBlobProjection)
        .values(attachmentRow)
        .onConflictDoUpdate({
          target: [
            documentAttachmentBlobProjection.localId,
            documentAttachmentBlobProjection.slotId,
          ],
          set: attachmentRow,
        })
        .run();
    });
  },
  async deleteLocalAttachment(execSql, localId, slotId, storageKey) {
    await getClientSQLitePersistenceRuntime(execSql).runMutation(async (db) => {
      await db
        .delete(documentAttachmentBlobProjection)
        .where(
          and(
            eq(documentAttachmentBlobProjection.localId, localId),
            eq(documentAttachmentBlobProjection.slotId, slotId),
            eq(documentAttachmentBlobProjection.storageKey, storageKey),
          ),
        )
        .run();
    });
  },
  async markLocalAttachmentDetached(execSql, localId, slotId, storageKey) {
    const detachedAt = new Date().toISOString();

    await getClientSQLitePersistenceRuntime(execSql).runMutation(async (db) => {
      await db
        .update(documentAttachmentBlobProjection)
        .set({ detachedAt })
        .where(
          and(
            eq(documentAttachmentBlobProjection.localId, localId),
            eq(documentAttachmentBlobProjection.slotId, slotId),
            eq(documentAttachmentBlobProjection.storageKey, storageKey),
            isNull(documentAttachmentBlobProjection.detachedAt),
          ),
        )
        .run();
    });
  },
  async savePendingAttachment(execSql, attachment) {
    const createdAt = new Date().toISOString();

    await getClientSQLitePersistenceRuntime(execSql).runMutation(async (db) => {
      const attachmentRow = buildPendingAttachmentRow(attachment, createdAt);
      await db
        .insert(documentPendingAttachments)
        .values(attachmentRow)
        .onConflictDoUpdate({
          target: [
            documentPendingAttachments.localId,
            documentPendingAttachments.slotId,
          ],
          set: {
            name: attachmentRow.name,
            mimeType: attachmentRow.mimeType,
            storageKey: attachmentRow.storageKey,
            byteLength: attachmentRow.byteLength,
            uploadBlobId: attachmentRow.uploadBlobId,
            uploadContentKey: attachmentRow.uploadContentKey,
            uploadIv: attachmentRow.uploadIv,
            uploadContentKeyEpoch: attachmentRow.uploadContentKeyEpoch,
            uploadPartSize: attachmentRow.uploadPartSize,
            uploadPlaintextSha256: attachmentRow.uploadPlaintextSha256,
            uploadStageId: attachmentRow.uploadStageId,
          },
        })
        .run();
    });
  },
  async deletePendingUpdate(execSql, id) {
    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      await deleteDocumentPendingUpdate(lockedExecSql, id);
    });
  },
  async deletePendingUpdates(execSql, localId) {
    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      await deleteDocumentPendingUpdates(
        lockedExecSql,
        getDocumentScope(localId),
      );
    });
  },
  async deletePendingAttachment(execSql, localId, slotId, storageKey) {
    await getClientSQLitePersistenceRuntime(execSql).runMutation(async (db) => {
      await db
        .delete(documentPendingAttachments)
        .where(
          and(
            eq(documentPendingAttachments.localId, localId),
            eq(documentPendingAttachments.slotId, slotId),
            eq(documentPendingAttachments.storageKey, storageKey),
          ),
        )
        .run();
    });
  },
  async deletePendingAttachments(execSql, localId) {
    await getClientSQLitePersistenceRuntime(execSql).runMutation(async (db) => {
      await db
        .delete(documentPendingAttachments)
        .where(eq(documentPendingAttachments.localId, localId))
        .run();
    });
  },
};

import { and, eq, isNull } from "drizzle-orm";
import {
  documentAttachmentBlobProjection,
  documentPendingAttachments,
} from "../../../sqlite/schema";
import type { ClientSQLiteTransactionScope } from "../../../sqlite/sqlitePersistenceRuntime";
import type { DocumentsPersistence } from "../types";
import { buildPendingAttachmentRow } from "./attachmentRows";

type AttachmentStaging = NonNullable<
  Parameters<
    DocumentsPersistence["commitDocumentMutation"]
  >[1]["attachmentStaging"]
>;
type AttachmentRemoval = NonNullable<
  Parameters<
    DocumentsPersistence["commitDocumentMutation"]
  >[1]["attachmentRemoval"]
>;

export async function applyStoredAttachmentRemoval(input: {
  localId: string;
  removal: AttachmentRemoval;
  tx: ClientSQLiteTransactionScope;
}): Promise<void> {
  const { localId, removal, tx } = input;
  const pendingMatch = and(
    eq(documentPendingAttachments.localId, localId),
    eq(documentPendingAttachments.slotId, removal.slotId),
    eq(documentPendingAttachments.storageKey, removal.storageKey),
  );
  const localMatch = and(
    eq(documentAttachmentBlobProjection.localId, localId),
    eq(documentAttachmentBlobProjection.slotId, removal.slotId),
    eq(documentAttachmentBlobProjection.storageKey, removal.storageKey),
  );
  await tx.delete(documentPendingAttachments).where(pendingMatch).run();
  if (removal.mode === "detach") {
    await tx
      .update(documentAttachmentBlobProjection)
      .set({ detachedAt: new Date().toISOString() })
      .where(
        and(localMatch, isNull(documentAttachmentBlobProjection.detachedAt)),
      )
      .run();
    return;
  }
  await tx.delete(documentAttachmentBlobProjection).where(localMatch).run();
}

function assertAttachmentScope(
  localId: string,
  staging: AttachmentStaging,
): void {
  const everyAttachmentMatchesScope = [
    ...staging.localAttachments,
    ...staging.pendingAttachments,
  ].every((attachment) => attachment.localId === localId);
  if (!everyAttachmentMatchesScope) {
    throw new Error("Attachment staging rows must share one document scope");
  }
}

export async function upsertStoredAttachmentStagingRows(input: {
  createdAt: string;
  localId: string;
  staging: AttachmentStaging;
  tx: ClientSQLiteTransactionScope;
}): Promise<void> {
  const { createdAt, localId, staging, tx } = input;
  assertAttachmentScope(localId, staging);

  for (const attachment of staging.pendingAttachments) {
    const row = buildPendingAttachmentRow(attachment, createdAt);
    await tx
      .insert(documentPendingAttachments)
      .values(row)
      .onConflictDoUpdate({
        target: [
          documentPendingAttachments.localId,
          documentPendingAttachments.slotId,
        ],
        set: {
          byteLength: row.byteLength,
          mimeType: row.mimeType,
          name: row.name,
          storageKey: row.storageKey,
          uploadBlobId: row.uploadBlobId,
          uploadContentKey: row.uploadContentKey,
          uploadContentKeyEpoch: row.uploadContentKeyEpoch,
          uploadIv: row.uploadIv,
          uploadPartSize: row.uploadPartSize,
          uploadPlaintextSha256: row.uploadPlaintextSha256,
          uploadStageId: row.uploadStageId,
        },
      })
      .run();
  }

  for (const attachment of staging.localAttachments) {
    const row = { ...attachment, updatedAt: createdAt };
    await tx
      .insert(documentAttachmentBlobProjection)
      .values(row)
      .onConflictDoUpdate({
        target: [
          documentAttachmentBlobProjection.localId,
          documentAttachmentBlobProjection.slotId,
        ],
        set: {
          blobId: row.blobId,
          byteLength: row.byteLength,
          detachedAt: row.detachedAt,
          mimeType: row.mimeType,
          storageKey: row.storageKey,
          updatedAt: row.updatedAt,
        },
      })
      .run();
  }
}

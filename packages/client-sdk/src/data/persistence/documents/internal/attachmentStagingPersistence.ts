import { and, eq, isNull } from "drizzle-orm";
import {
  documentAttachmentBlobProjection,
  documentPendingAttachments,
} from "../../../sqlite/schema";
import type { ClientSQLiteTransactionScope } from "../../../sqlite/sqlitePersistenceRuntime";
import type { DocumentsPersistence } from "../types";
import { buildPendingAttachmentRow } from "./attachmentRows";
import { queueDocumentAttachmentStorageKeys } from "./orphanSideRows";

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
  const [pending] = await tx
    .delete(documentPendingAttachments)
    .where(pendingMatch)
    .returning();
  // A pending upload without a remote identity needs no detach marker.
  // Reclaim keeps any key that a marker or another row still references.
  await queueDocumentAttachmentStorageKeys(tx, [removal.storageKey]);
  if (removal.mode === "detach") {
    const detachedAt = new Date().toISOString();
    // The bind may have committed before its response (or settlement) was lost.
    // Preserve its identity until sync confirms that the binding is detached.
    if (pending?.uploadBlobId) {
      await tx
        .insert(documentAttachmentBlobProjection)
        .values({
          localId,
          slotId: removal.slotId,
          storageKey: removal.storageKey,
          blobId: pending.uploadBlobId,
          byteLength: pending.byteLength,
          contentSha256: pending.contentSha256,
          mimeType: pending.mimeType,
          detachedAt,
          updatedAt: detachedAt,
        })
        .onConflictDoNothing()
        .run();
    }
    await tx
      .update(documentAttachmentBlobProjection)
      .set({ detachedAt })
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
    const [existing] = await tx
      .select({ storageKey: documentPendingAttachments.storageKey })
      .from(documentPendingAttachments)
      .where(
        and(
          eq(documentPendingAttachments.localId, localId),
          eq(documentPendingAttachments.slotId, attachment.slotId),
        ),
      )
      .limit(1);
    if (existing && existing.storageKey !== row.storageKey) {
      await queueDocumentAttachmentStorageKeys(tx, [existing.storageKey]);
    }
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
          contentSha256: row.contentSha256,
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
    const [existing] = await tx
      .select({ storageKey: documentAttachmentBlobProjection.storageKey })
      .from(documentAttachmentBlobProjection)
      .where(
        and(
          eq(documentAttachmentBlobProjection.localId, localId),
          eq(documentAttachmentBlobProjection.slotId, attachment.slotId),
        ),
      )
      .limit(1);
    if (existing && existing.storageKey !== row.storageKey) {
      await queueDocumentAttachmentStorageKeys(tx, [existing.storageKey]);
    }
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
          contentSha256: row.contentSha256,
          detachedAt: row.detachedAt,
          mimeType: row.mimeType,
          storageKey: row.storageKey,
          updatedAt: row.updatedAt,
        },
      })
      .run();
  }
}

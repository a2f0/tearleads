import { inArray } from "drizzle-orm";
import { queueDocumentAttachmentStorageKeys } from "../../data/persistence/documents/internal/orphanSideRows";
import { documentPendingAttachments } from "../../data/sqlite/schema";
import type { ClientSQLiteTransactionScope } from "../../data/sqlite/sqlitePersistenceRuntime";
import { remoteResetBatches } from "./remoteResetBatches";
import type { ResetAttachmentUpload } from "./remoteResetPlans";

/** Delete reset-scoped pending rows without abandoning dropped local bytes. */
export async function clearResetPendingAttachments(input: {
  readonly attachmentUploads: readonly ResetAttachmentUpload[];
  readonly documentLocalIds: readonly string[];
  readonly tx: ClientSQLiteTransactionScope;
}): Promise<void> {
  const requeuedKeys = new Set(
    input.attachmentUploads.map(
      (attachment) => `${attachment.localId}\0${attachment.slotId}`,
    ),
  );
  for (const localIdBatch of remoteResetBatches(input.documentLocalIds)) {
    const rows = await input.tx
      .select({
        localId: documentPendingAttachments.localId,
        slotId: documentPendingAttachments.slotId,
        storageKey: documentPendingAttachments.storageKey,
      })
      .from(documentPendingAttachments)
      .where(inArray(documentPendingAttachments.localId, localIdBatch));
    await queueDocumentAttachmentStorageKeys(
      input.tx,
      rows
        .filter((row) => !requeuedKeys.has(`${row.localId}\0${row.slotId}`))
        .map((row) => row.storageKey),
    );
    await input.tx
      .delete(documentPendingAttachments)
      .where(inArray(documentPendingAttachments.localId, localIdBatch))
      .run();
  }
}

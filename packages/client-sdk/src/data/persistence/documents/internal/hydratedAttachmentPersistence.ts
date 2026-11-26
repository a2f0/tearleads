import { and, eq } from "drizzle-orm";
import { DOCUMENTS_APP_KIND } from "../../../documents/documentConstants";
import { documentAttachmentBlobProjection } from "../../../sqlite/schema";
import { documents } from "../../../sqlite/schema/documentRecordSchema";
import { getClientSQLitePersistenceRuntime } from "../../../sqlite/sqlitePersistenceRuntime";
import type { DocumentsPersistence } from "../types";
import { queueDocumentAttachmentStorageKeys } from "./orphanSideRows";

export const saveHydratedAttachment: DocumentsPersistence["saveHydratedAttachment"] =
  async (execSql, input) => {
    const { attachment, expectedStorageKey, stillCurrent } = input;
    const outcome = await getClientSQLitePersistenceRuntime(
      execSql,
    ).guardedTransaction(
      async (tx) => {
        // Attachment rows carry a document's local id and no app kind, so
        // the full primary key names the one row this guard is about.
        const [document] = await tx
          .select({ snapshotEndVersion: documents.snapshotEndVersion })
          .from(documents)
          .where(
            and(
              eq(documents.appKind, DOCUMENTS_APP_KIND),
              eq(documents.localId, attachment.localId),
            ),
          )
          .limit(1);
        if (
          (document?.snapshotEndVersion ?? null) !==
          input.expectedSnapshotEndVersion
        )
          return false;
        const [existing] = await tx
          .select({ storageKey: documentAttachmentBlobProjection.storageKey })
          .from(documentAttachmentBlobProjection)
          .where(
            and(
              eq(documentAttachmentBlobProjection.localId, attachment.localId),
              eq(documentAttachmentBlobProjection.slotId, attachment.slotId),
            ),
          )
          .limit(1);
        if ((existing?.storageKey ?? null) !== expectedStorageKey) return false;
        const row = { ...attachment, updatedAt: new Date().toISOString() };
        await tx
          .insert(documentAttachmentBlobProjection)
          .values(row)
          .onConflictDoUpdate({
            target: [
              documentAttachmentBlobProjection.localId,
              documentAttachmentBlobProjection.slotId,
            ],
            set: row,
          })
          .run();
        if (
          expectedStorageKey &&
          expectedStorageKey !== attachment.storageKey
        ) {
          await queueDocumentAttachmentStorageKeys(tx, [expectedStorageKey]);
        }
        return true;
      },
      stillCurrent,
      { behavior: "immediate" },
    );
    const committed = outcome.committed && outcome.result === true;
    if (!committed) {
      await getClientSQLitePersistenceRuntime(execSql).transaction((tx) =>
        queueDocumentAttachmentStorageKeys(tx, [attachment.storageKey]),
      );
    }
    return committed;
  };

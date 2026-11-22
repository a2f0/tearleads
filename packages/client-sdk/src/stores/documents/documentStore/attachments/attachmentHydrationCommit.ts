import { getDocumentAttachments } from "../../../../data/documents/documentContent";
import type { HydratedDocumentAttachmentBlob as HydratedBlob } from "../../../../workflows/blobs";
import {
  type LocalAttachmentRecord,
  runSerializedDocumentBlobMutation,
} from "../../../../workflows/documents";
import { saveHydratedDocumentAttachment } from "../../../../workflows/documents/attachments/attachmentPersistence";
import type { DocumentState, DocumentStoreState } from "../state";
import { noteAttachmentDownloaded } from "../sync/downloadCompletion";
import {
  installLocalAttachmentRecords,
  removeLocalAttachmentSlot,
} from "./attachmentPersistence";
import { dispatchHeldCopyCheck } from "./heldCopyChecks";

export async function commitHydratedAttachment(input: {
  state: DocumentStoreState;
  currentDoc: DocumentState;
  hydratedBlob: Pick<
    HydratedBlob,
    "attachment" | "bytes" | "contentSha256" | "storageKey"
  > & {
    binding: Pick<HydratedBlob["binding"], "blobId">;
  };
  expectedStorageKey: string | null;
  generationIsCurrent: () => boolean;
}): Promise<void> {
  const {
    state,
    currentDoc,
    hydratedBlob,
    expectedStorageKey,
    generationIsCurrent,
  } = input;
  const runtime = state.runtime;
  const expectedSnapshotEndVersion = state.record?.snapshotEndVersion ?? null;
  const stillCurrent = () =>
    generationIsCurrent() &&
    state.doc === currentDoc &&
    getDocumentAttachments(currentDoc).some(
      (attachment) =>
        attachment.slotId === hydratedBlob.attachment.slotId &&
        attachment.contentSha256 === hydratedBlob.attachment.contentSha256,
    );
  await runSerializedDocumentBlobMutation(
    runtime.infra.execSql,
    hydratedBlob.storageKey,
    async () => {
      if (!stillCurrent()) return;
      await runtime.infra.blobStore.writeBytes(
        hydratedBlob.storageKey,
        hydratedBlob.bytes,
      );
      const attachment: LocalAttachmentRecord = {
        blobId: hydratedBlob.binding.blobId,
        // The held bytes' own size, not the document intent's: a served
        // binding the intent has not recorded yet may differ in length, and
        // preview gating reads the local record.
        byteLength: hydratedBlob.bytes.byteLength,
        contentSha256: hydratedBlob.contentSha256,
        detachedAt: null,
        localId: state.localId,
        mimeType: hydratedBlob.attachment.mimeType,
        slotId: hydratedBlob.attachment.slotId,
        storageKey: hydratedBlob.storageKey,
      };
      const committed = await saveHydratedDocumentAttachment({
        execSql: runtime.infra.execSql,
        persistence: state.persistence,
        attachment,
        expectedStorageKey,
        expectedSnapshotEndVersion,
        stillCurrent,
      });
      if (committed && stillCurrent()) {
        // These bytes match the row just written, so a copy a check found
        // missing or damaged is held again.
        const { contentSha256, slotId, storageKey } = attachment;
        const { blobStore } = runtime.infra;
        dispatchHeldCopyCheck(state, slotId, {
          type: "copyWritten",
          copy: { blobStore, contentSha256, storageKey },
        });
        installLocalAttachmentRecords(state, [attachment], currentDoc);
        if (expectedStorageKey === null)
          noteAttachmentDownloaded({
            attachment,
            fileName: hydratedBlob.attachment.name,
            state,
          });
      } else if (!committed && stillCurrent())
        await refreshRefusedAttachmentSlot(input, stillCurrent);
    },
  );
}

async function refreshRefusedAttachmentSlot(
  input: Parameters<typeof commitHydratedAttachment>[0],
  stillCurrent: () => boolean,
): Promise<void> {
  const { state, currentDoc, hydratedBlob } = input;
  const rows = await state.persistence.listLocalAttachments(
    state.runtime.infra.execSql,
    state.localId,
  );
  if (!stillCurrent()) return;
  const slotId = hydratedBlob.attachment.slotId;
  removeLocalAttachmentSlot(state, slotId);
  installLocalAttachmentRecords(
    state,
    rows.filter((row) => row.slotId === slotId),
    currentDoc,
  );
}

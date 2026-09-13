import { getDocumentAttachments } from "../../../data/documents/documentContent";
import type { hydrateDocumentAttachmentBlobs } from "../../../workflows/blobs";
import {
  type LocalAttachmentRecord,
  runSerializedDocumentBlobMutation,
} from "../../../workflows/documents";
import { saveHydratedDocumentAttachment } from "../../../workflows/documents/attachmentPersistence";
import { installLocalAttachmentRecords } from "./attachmentPersistence";
import type { DocumentState, DocumentStoreState } from "./state";

type HydratedBlob = NonNullable<
  Awaited<ReturnType<typeof hydrateDocumentAttachmentBlobs>>
>[number];

export async function commitHydratedAttachment(input: {
  state: DocumentStoreState;
  currentDoc: DocumentState;
  hydratedBlob: Pick<HydratedBlob, "attachment" | "bytes" | "storageKey"> & {
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
        byteLength: hydratedBlob.attachment.byteLength,
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
        stillCurrent,
      });
      if (committed && stillCurrent())
        installLocalAttachmentRecords(state, [attachment], currentDoc);
    },
  );
}

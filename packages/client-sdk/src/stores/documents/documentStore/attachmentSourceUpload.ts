import type { BlobByteSource } from "../../../data/blobContracts";
import {
  type BlobSourceSnapshot,
  inspectBlobSource,
} from "../../../data/documents/blob/shared/blobSourceSnapshot";
import { DEFAULT_BLOB_CHUNK_SIZE_BYTES } from "../../../data/documents/blob/shared/crypto";
import { getDocumentAttachments } from "../../../data/documents/documentContent";
import type { PendingAttachmentRecord } from "../../../workflows/documents";
import {
  type AttachmentUploadResume,
  resolveAttachmentUploadResume,
} from "./attachmentUploadResume";
import type { DocumentStoreState } from "./state";
import type { DocumentStoreSyncGeneration } from "./syncGeneration";

export async function resolveAttachmentSourceUpload(input: {
  attachmentGeneration: DocumentStoreSyncGeneration;
  pendingAttachment: PendingAttachmentRecord;
  source: BlobByteSource;
  state: DocumentStoreState;
}): Promise<{
  readonly resume: AttachmentUploadResume;
  readonly snapshot: BlobSourceSnapshot;
}> {
  let chunkSize =
    input.pendingAttachment.upload?.partSize ?? DEFAULT_BLOB_CHUNK_SIZE_BYTES;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const snapshot = await inspectBlobSource(input.source, chunkSize);
    const attachment =
      input.state.doc &&
      getDocumentAttachments(input.state.doc).find(
        (item) => item.slotId === input.pendingAttachment.slotId,
      );
    if (!attachment || attachment.contentSha256 !== snapshot.sha256) {
      throw new Error(
        "Attachment upload bytes differ from the current document content",
      );
    }
    const resume = await resolveAttachmentUploadResume(
      input.state,
      input.pendingAttachment,
      snapshot.sha256,
      input.attachmentGeneration,
    );
    const resolvedChunkSize =
      resume.multipart?.partSize ?? DEFAULT_BLOB_CHUNK_SIZE_BYTES;
    if (resolvedChunkSize === snapshot.chunkSize) {
      return { resume, snapshot };
    }
    chunkSize = resolvedChunkSize;
  }

  throw new Error("Blob source changed while preparing its upload identity");
}

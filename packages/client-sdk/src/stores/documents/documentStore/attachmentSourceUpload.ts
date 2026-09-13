import type { BlobByteSource } from "../../../data/blobContracts";
import {
  type BlobSourceSnapshot,
  inspectBlobSource,
} from "../../../data/documents/blob/shared/blobSourceSnapshot";
import { DEFAULT_BLOB_CHUNK_SIZE_BYTES } from "../../../data/documents/blob/shared/crypto";
import { getDocumentAttachments } from "../../../data/documents/documentContent";
import type { PendingAttachmentRecord } from "../../../workflows/documents";
import { deletePendingAttachment } from "./attachmentPersistence";
import {
  type AttachmentUploadResume,
  resolveAttachmentUploadResume,
} from "./attachmentUploadResume";
import type { DocumentStoreState } from "./state";
import type { DocumentStoreSyncGeneration } from "./syncGeneration";

interface PendingSourceInput {
  attachmentGeneration: DocumentStoreSyncGeneration;
  pendingAttachment: PendingAttachmentRecord;
  state: DocumentStoreState;
}

export function pendingAttachmentMatchesIntent(
  input: PendingSourceInput,
): boolean {
  return (
    input.state.doc !== null &&
    getDocumentAttachments(input.state.doc).some(
      (item) =>
        item.slotId === input.pendingAttachment.slotId &&
        item.contentSha256 === input.pendingAttachment.contentSha256,
    )
  );
}

export async function dropUnavailablePendingAttachment(
  input: PendingSourceInput,
): Promise<"dropped"> {
  const { state, pendingAttachment, attachmentGeneration } = input;
  // Unusable bytes or superseded intent cannot be retried. Delete only this
  // storage identity so a concurrently queued replacement survives.
  state.runtime.util.log(
    `Documents: dropping pending attachment ${pendingAttachment.slotId}; its bytes are unavailable or changed, or its content intent was superseded.`,
  );
  await deletePendingAttachment(
    state,
    pendingAttachment.slotId,
    pendingAttachment.storageKey,
    attachmentGeneration,
  );
  return "dropped";
}

export async function resolveAttachmentSourceUpload(
  input: PendingSourceInput & {
    source: BlobByteSource;
  },
): Promise<{
  readonly resume: AttachmentUploadResume;
  readonly snapshot: BlobSourceSnapshot;
} | null> {
  let chunkSize =
    input.pendingAttachment.upload?.partSize ?? DEFAULT_BLOB_CHUNK_SIZE_BYTES;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const snapshot = await inspectBlobSource(input.source, chunkSize);
    if (!pendingAttachmentMatchesIntent(input)) return null;
    if (input.pendingAttachment.contentSha256 !== snapshot.sha256) {
      return null;
    }
    const resume = await resolveAttachmentUploadResume(
      input.state,
      input.pendingAttachment,
      snapshot.sha256,
      input.attachmentGeneration,
    );
    const resolvedChunkSize =
      resume.multipart?.partSize ?? DEFAULT_BLOB_CHUNK_SIZE_BYTES;
    if (!pendingAttachmentMatchesIntent(input)) return null;
    if (resolvedChunkSize === snapshot.chunkSize) {
      return { resume, snapshot };
    }
    chunkSize = resolvedChunkSize;
  }

  throw new Error("Blob source changed while preparing its upload identity");
}

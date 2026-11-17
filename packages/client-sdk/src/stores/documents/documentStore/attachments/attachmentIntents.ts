import type { DocumentAttachment } from "../../../../data/documents/documentContent";
import {
  attachmentContentSha256,
  blobByteSourceInputLength,
} from "../../../../workflows/blobs";
import type { PendingAttachmentRecord } from "../../../../workflows/documents";
import type { DocumentAttachmentUpload } from "../../types";

export async function buildPendingAttachments(
  localId: string,
  files: ReadonlyArray<DocumentAttachmentUpload>,
): Promise<{
  nextAttachments: DocumentAttachment[];
  nextPendingAttachments: PendingAttachmentRecord[];
}> {
  const nextPendingAttachments: PendingAttachmentRecord[] = [];
  const nextAttachments: DocumentAttachment[] = [];

  for (const file of files) {
    const slotId = crypto.randomUUID();
    const storageKey = `${localId}-${slotId}`;
    const byteLength = blobByteSourceInputLength(file.bytes);
    const contentSha256 = await attachmentContentSha256(file.bytes);
    nextPendingAttachments.push({
      byteLength,
      contentSha256,
      localId,
      mimeType: file.mimeType,
      name: file.name,
      slotId,
      storageKey,
    });
    nextAttachments.push({
      contentSha256,
      byteLength,
      mimeType: file.mimeType,
      name: file.name,
      slotId,
    });
  }

  return { nextAttachments, nextPendingAttachments };
}

export async function buildAttachmentIntent(
  slotId: string,
  file: DocumentAttachmentUpload,
): Promise<DocumentAttachment> {
  return {
    contentSha256: await attachmentContentSha256(file.bytes),
    byteLength: blobByteSourceInputLength(file.bytes),
    mimeType: file.mimeType,
    name: file.name,
    slotId,
  };
}

import type { BlobStore, FileSaver } from "@tearleads/client-sdk";
import { downloadBytesAsFile } from "../../utils/downloadFile";

interface DownloadableAttachment {
  mimeType: string | null;
  name: string | null;
  storageKey: string;
}

interface AttachmentSlotRef {
  mimeType: string | null;
  name: string;
  slotId: string;
}

// The bytes a file document exposes for download live on its most recent
// attachment that has a locally resolved blob (a storage key). An attachment
// whose blob has not synced down yet has no entry in the slot->key map, so it is
// skipped and the previous synced revision (if any) is offered instead.
export function resolveDownloadableAttachment(
  attachments: ReadonlyArray<AttachmentSlotRef>,
  attachmentStorageKeyBySlotId: Readonly<Record<string, string>>,
): DownloadableAttachment | null {
  for (let index = attachments.length - 1; index >= 0; index -= 1) {
    const attachment = attachments[index];
    if (!attachment) {
      continue;
    }
    const storageKey = attachmentStorageKeyBySlotId[attachment.slotId];
    if (storageKey) {
      return {
        mimeType: attachment.mimeType,
        name: attachment.name,
        storageKey,
      };
    }
  }
  return null;
}

// Read the resolved bytes and hand them to the browser. Returns false when the
// bytes are not present locally (e.g. a blob that has not synced down yet), so
// callers can surface an "unavailable offline" message instead of failing
// silently.
export async function downloadResolvedAttachment(input: {
  attachment: DownloadableAttachment;
  blobStore: BlobStore;
  fallbackFileName: string;
  fileSaver: FileSaver;
}): Promise<boolean> {
  const bytes = await input.blobStore.readBytes(input.attachment.storageKey);
  if (!bytes) {
    return false;
  }
  await downloadBytesAsFile(input.fileSaver, {
    bytes,
    fileName: input.attachment.name?.trim() || input.fallbackFileName,
    mimeType: input.attachment.mimeType,
  });
  return true;
}

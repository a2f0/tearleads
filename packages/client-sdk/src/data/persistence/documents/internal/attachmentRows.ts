import type { LocalAttachmentRecord, PendingAttachmentRecord } from "../types";

interface SelectedPendingAttachment {
  localId: string;
  slotId: string;
  name: string;
  mimeType: string | null;
  storageKey: string;
  byteLength: number;
  uploadBlobId: string | null;
  uploadContentKey: string | null;
  uploadIv: string | null;
  uploadContentKeyEpoch: number | null;
  uploadPartSize: number | null;
  uploadStageId: string | null;
}

interface SelectedLocalAttachment {
  localId: string;
  slotId: string;
  blobId: string | null;
  storageKey: string;
  mimeType: string | null;
  byteLength: number;
}

export function mapPendingAttachmentRecord(
  row: SelectedPendingAttachment,
): PendingAttachmentRecord {
  // The upload identity is written atomically (blob id, content key, IV and
  // epoch together), so its presence is keyed off the blob id.
  const upload =
    row.uploadBlobId !== null &&
    row.uploadContentKey !== null &&
    row.uploadIv !== null &&
    row.uploadContentKeyEpoch !== null
      ? {
          blobId: row.uploadBlobId,
          contentKey: row.uploadContentKey,
          contentKeyEpoch: row.uploadContentKeyEpoch,
          iv: row.uploadIv,
          partSize: row.uploadPartSize,
          stageId: row.uploadStageId,
        }
      : null;
  return {
    byteLength: row.byteLength,
    localId: row.localId,
    mimeType: row.mimeType,
    name: row.name,
    slotId: row.slotId,
    storageKey: row.storageKey,
    upload,
  };
}

export function mapLocalAttachmentRecord(
  row: SelectedLocalAttachment,
): LocalAttachmentRecord {
  return {
    blobId: row.blobId,
    byteLength: row.byteLength,
    localId: row.localId,
    mimeType: row.mimeType,
    slotId: row.slotId,
    storageKey: row.storageKey,
  };
}

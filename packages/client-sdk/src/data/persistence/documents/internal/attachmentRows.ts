import type {
  LocalAttachmentRecord,
  PendingAttachmentRecord,
  PendingAttachmentUploadIdentity,
} from "../types";

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
  uploadPlaintextSha256: string | null;
  uploadStageId: string | null;
}

interface SelectedLocalAttachment {
  localId: string;
  slotId: string;
  blobId: string | null;
  storageKey: string;
  mimeType: string | null;
  byteLength: number;
  detachedAt: string | null;
}

export function buildPendingAttachmentRow(
  attachment: PendingAttachmentRecord,
  createdAt: string,
) {
  return {
    byteLength: attachment.byteLength,
    createdAt,
    localId: attachment.localId,
    mimeType: attachment.mimeType,
    name: attachment.name,
    slotId: attachment.slotId,
    storageKey: attachment.storageKey,
    uploadBlobId: attachment.upload?.blobId ?? null,
    uploadContentKey: attachment.upload?.contentKey ?? null,
    uploadContentKeyEpoch: attachment.upload?.contentKeyEpoch ?? null,
    uploadIv: attachment.upload?.nonceSeed ?? null,
    uploadPartSize: attachment.upload?.partSize ?? null,
    uploadPlaintextSha256: attachment.upload?.plaintextSha256 ?? null,
    uploadStageId: attachment.upload?.stageId ?? null,
  };
}

export function mapPendingAttachmentRecord(
  row: SelectedPendingAttachment,
): PendingAttachmentRecord {
  const identityFields = [
    row.uploadBlobId,
    row.uploadContentKey,
    row.uploadIv,
    row.uploadContentKeyEpoch,
    row.uploadPlaintextSha256,
  ];
  const hasIdentityField = identityFields.some((value) => value !== null);
  const hasCompleteIdentity = identityFields.every((value) => value !== null);
  if (hasIdentityField !== hasCompleteIdentity) {
    throw new Error("Pending attachment upload identity is incomplete.");
  }
  if ((row.uploadPartSize === null) !== (row.uploadStageId === null)) {
    throw new Error("Pending attachment multipart identity is incomplete.");
  }
  if (!hasIdentityField && row.uploadPartSize !== null) {
    throw new Error("Pending attachment multipart identity has no upload.");
  }

  let upload: PendingAttachmentUploadIdentity | null = null;
  if (
    row.uploadBlobId !== null &&
    row.uploadContentKey !== null &&
    row.uploadIv !== null &&
    row.uploadContentKeyEpoch !== null &&
    row.uploadPlaintextSha256 !== null
  ) {
    upload = {
      blobId: row.uploadBlobId,
      contentKey: row.uploadContentKey,
      contentKeyEpoch: row.uploadContentKeyEpoch,
      nonceSeed: row.uploadIv,
      partSize: row.uploadPartSize,
      plaintextSha256: row.uploadPlaintextSha256,
      stageId: row.uploadStageId,
    };
  }
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
    detachedAt: row.detachedAt,
    localId: row.localId,
    mimeType: row.mimeType,
    slotId: row.slotId,
    storageKey: row.storageKey,
  };
}

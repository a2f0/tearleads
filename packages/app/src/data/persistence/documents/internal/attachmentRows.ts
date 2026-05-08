import type { LocalAttachmentRecord, PendingAttachmentRecord } from "../types";

interface SelectedPendingAttachment {
  localId: string;
  slotId: string;
  name: string;
  mimeType: string | null;
  storageKey: string;
  byteLength: number;
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
  return {
    byteLength: row.byteLength,
    localId: row.localId,
    mimeType: row.mimeType,
    name: row.name,
    slotId: row.slotId,
    storageKey: row.storageKey,
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

import type {
  BlobByteSourceInput,
  BlobInfo,
  BlobStore,
  DocumentAttachment,
  DocumentAttachmentStatus,
} from "@tearleads/client-sdk";

export interface DocumentAttachmentSlot {
  label: string;
  slotId: string;
}

export interface DocumentAttachmentUpload {
  bytes: BlobByteSourceInput;
  mimeType: string | null;
  name: string;
}

export const AUTOMATIC_BLOB_PREVIEW_MAX_BYTES = 5 * 1024 * 1024;

export function isAutomaticBlobPreviewAllowed(
  blob: Pick<BlobInfo, "byteLength">,
): boolean {
  return (
    Number.isSafeInteger(blob.byteLength) &&
    blob.byteLength >= 0 &&
    blob.byteLength <= AUTOMATIC_BLOB_PREVIEW_MAX_BYTES
  );
}

export function createFrontAndBackImageSlots(params: {
  backSlotId: string;
  frontSlotId: string;
}): ReadonlyArray<DocumentAttachmentSlot> {
  const { backSlotId, frontSlotId } = params;

  return [
    {
      label: "Front Image",
      slotId: frontSlotId,
    },
    {
      label: "Back Image",
      slotId: backSlotId,
    },
  ];
}

export async function readDocumentAttachmentUpload(
  file: File,
): Promise<DocumentAttachmentUpload> {
  return {
    bytes: file,
    mimeType: file.type.length > 0 ? file.type : null,
    name: file.name,
  };
}

export function isImageDocumentAttachmentBlob(
  blob: Pick<BlobInfo, "mimeType">,
) {
  return blob.mimeType?.startsWith("image/") === true;
}

export function getDocumentAttachmentBlobName(
  blob: Pick<BlobInfo, "blobId" | "name" | "references" | "storageKey">,
): string {
  return (
    blob.name ??
    blob.references?.find((reference) => reference.name)?.name ??
    blob.blobId ??
    blob.storageKey
  );
}

export async function readBlobDocumentAttachmentUpload(params: {
  blob: BlobInfo;
  blobStore: BlobStore;
}): Promise<DocumentAttachmentUpload> {
  const { blob, blobStore } = params;
  const bytes = await blobStore.openByteSource(blob.storageKey);

  if (!bytes) {
    throw new Error(
      `Blob ${blob.blobId ?? blob.storageKey} has no local bytes.`,
    );
  }

  return {
    bytes,
    mimeType: blob.mimeType,
    name: getDocumentAttachmentBlobName(blob),
  };
}

export function getDocumentAttachmentStatusLabel(
  status: DocumentAttachmentStatus | undefined,
): string | null {
  if (status === "syncing") {
    return "Syncing image.";
  }

  return null;
}

export function getLatestDocumentAttachmentBySlotId(
  attachments: ReadonlyArray<DocumentAttachment>,
  slotId: string,
): DocumentAttachment | null {
  return (
    attachments.findLast((attachment) => attachment.slotId === slotId) ?? null
  );
}

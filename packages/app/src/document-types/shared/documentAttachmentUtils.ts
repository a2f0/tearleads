import type { BlobBytes } from "../../data/blobs";
import type { DocumentAttachment } from "../../data/documents/documentContent";
import type { DocumentAttachmentStatus } from "../../stores/documents/DocumentsProvider";

export interface DocumentAttachmentSlot {
  description: string;
  label: string;
  slotId: string;
}

export interface DocumentAttachmentUpload {
  bytes: BlobBytes;
  mimeType: string | null;
  name: string;
}

export function createFrontAndBackImageSlots(params: {
  backSlotId: string;
  frontSlotId: string;
}): ReadonlyArray<DocumentAttachmentSlot> {
  const { backSlotId, frontSlotId } = params;

  return [
    {
      description: "Opaque slot binding for the front image.",
      label: "Front Image",
      slotId: frontSlotId,
    },
    {
      description: "Opaque slot binding for the back image.",
      label: "Back Image",
      slotId: backSlotId,
    },
  ];
}

export async function readDocumentAttachmentUpload(
  file: File,
): Promise<DocumentAttachmentUpload> {
  return {
    bytes: new Uint8Array(await file.arrayBuffer()) as BlobBytes,
    mimeType: file.type.length > 0 ? file.type : null,
    name: file.name,
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

import type {
  BlobByteSourceInput,
  BlobInfo,
  BlobStore,
  DocumentAttachment,
  DocumentAttachmentStatus,
} from "@tearleads/client-sdk";
import { inferFileMimeType } from "./fileMimeType";

/**
 * The files a slot takes. Cards and photos are images; policies, titles, and
 * prescriptions often arrive as PDFs, so their slots take either.
 */
export type DocumentAttachmentAccept = "image" | "image-or-pdf";

export interface DocumentAttachmentSlot {
  label: string;
  slotId: string;
  /** Defaults to images only. */
  accept?: DocumentAttachmentAccept;
  /** A named collection; each file has its own immutable storage slot. */
  multiple?: boolean;
  /** A collection item's label, numbered as "Photo 1"; defaults to `label`. */
  itemLabel?: string;
}

const PDF_MIME_TYPE = "application/pdf";

export function getAttachmentSlotAccept(
  slot: Pick<DocumentAttachmentSlot, "accept">,
): DocumentAttachmentAccept {
  return slot.accept ?? "image";
}

/** The file chooser's `accept` attribute for a slot. */
export function getAttachmentSlotFileInputAccept(
  accept: DocumentAttachmentAccept,
): string {
  return accept === "image-or-pdf" ? `image/*,${PDF_MIME_TYPE}` : "image/*";
}

/** What a slot's actions and placeholders call its file: "Image" or "File". */
export function getAttachmentSlotNoun(
  accept: DocumentAttachmentAccept,
): "File" | "Image" {
  return accept === "image-or-pdf" ? "File" : "Image";
}

export function resolveAttachmentUploadSlot(
  slotId: string,
  slots: ReadonlyArray<DocumentAttachmentSlot>,
): string {
  return slots.some((slot) => slot.slotId === slotId && slot.multiple)
    ? `${slotId}:${crypto.randomUUID()}`
    : slotId;
}

export function expandAttachmentSlots(
  slots: ReadonlyArray<DocumentAttachmentSlot>,
  attachments: ReadonlyArray<DocumentAttachment>,
  mode: { canAttach: boolean; isEditing: boolean },
): ReadonlyArray<DocumentAttachmentSlot> {
  return slots.flatMap((slot) => {
    if (!slot.multiple) return [slot];
    // Each item lives in its own `<slot>:<uuid>` slot; the bare slot is only
    // the collection's append action. An empty collection keeps it while
    // editing, so the card holds its place until attaching becomes possible;
    // a reader has nothing to append, so an empty collection shows nothing.
    const expanded: DocumentAttachmentSlot[] = attachments
      .filter((attachment) => attachment.slotId.startsWith(`${slot.slotId}:`))
      .map((item, index) => ({
        ...(slot.accept ? { accept: slot.accept } : {}),
        label: `${slot.itemLabel ?? slot.label} ${index + 1}`,
        slotId: item.slotId,
      }));
    if (mode.canAttach || (mode.isEditing && expanded.length === 0)) {
      expanded.push(slot);
    }
    return expanded;
  });
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

/**
 * Read a held attachment for an automatic preview only when the bytes actually
 * held are within the preview limit. The document intent's `byteLength` is a
 * pre-filter, not a guard: a validly signed served binding the intent has not
 * recorded yet (an `intent-mismatch` slot) can be far larger than the intent
 * says, so the size of the local byte source is what gates the read.
 */
export async function readAutomaticPreviewBlobBytes(
  blobStore: Pick<BlobStore, "openByteSource">,
  storageKey: string,
): Promise<Uint8Array<ArrayBuffer> | null> {
  const source = await blobStore.openByteSource(storageKey);
  if (!source || !isAutomaticBlobPreviewAllowed(source)) {
    return null;
  }
  return source.read(0, source.byteLength);
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
  // A PDF dropped from a file manager often arrives untyped; its extension
  // then names it, so every reader of the attachment sees a PDF.
  return {
    bytes: file,
    mimeType: inferFileMimeType(file) || file.type || null,
    name: file.name,
  };
}

export function isImageDocumentAttachmentBlob(
  blob: Pick<BlobInfo, "mimeType">,
) {
  return blob.mimeType?.startsWith("image/") === true;
}

export function isPdfMimeType(value: string | null | undefined): boolean {
  return value?.split(";")[0]?.trim().toLowerCase() === PDF_MIME_TYPE;
}

export function isPdfDocumentAttachmentBlob(blob: Pick<BlobInfo, "mimeType">) {
  return isPdfMimeType(blob.mimeType);
}

/** Whether a blob can fill a slot that takes `accept`. */
export function isDocumentAttachmentBlobAccepted(
  accept: DocumentAttachmentAccept,
  blob: Pick<BlobInfo, "mimeType">,
) {
  return (
    isImageDocumentAttachmentBlob(blob) ||
    (accept === "image-or-pdf" && isPdfDocumentAttachmentBlob(blob))
  );
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
  noun: "File" | "Image" = "Image",
): string | null {
  if (status === "syncing") {
    return `Syncing ${noun.toLowerCase()}.`;
  }
  if (status === "intent-mismatch") {
    return `${noun} differs from the document's recorded version.`;
  }
  if (status === "unavailable") {
    return `${noun} missing or damaged on this device.`;
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

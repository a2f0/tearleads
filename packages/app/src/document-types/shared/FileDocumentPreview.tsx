import type { BlobStore, DocumentAttachment } from "@tearleads/client-sdk";
import { useMemo } from "react";
import { useAttachmentImageUrls } from "./useAttachmentImageUrls";

const FILE_DOCUMENT_PREVIEW_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/svg+xml",
]);

export interface FileDocumentImagePreview {
  attachment: DocumentAttachment;
  imageUrl: string | null;
}

type AttachmentStorageKeyBySlotId = Readonly<Record<string, string>>;
type AttachmentImageUrlBySlotId = Readonly<Record<string, string | undefined>>;

function normalizeFileDocumentMimeType(
  value: string | null | undefined,
): string {
  return value?.split(";")[0]?.trim().toLowerCase() ?? "";
}

export function isRenderableFileDocumentImageMimeType(
  mimeType: string | null | undefined,
): boolean {
  return FILE_DOCUMENT_PREVIEW_IMAGE_MIME_TYPES.has(
    normalizeFileDocumentMimeType(mimeType),
  );
}

function resolveLocalFileDocumentAttachment(
  attachments: ReadonlyArray<DocumentAttachment>,
  attachmentStorageKeyBySlotId: AttachmentStorageKeyBySlotId,
): DocumentAttachment | null {
  for (let index = attachments.length - 1; index >= 0; index -= 1) {
    const attachment = attachments[index];
    if (attachment && attachmentStorageKeyBySlotId[attachment.slotId]) {
      return attachment;
    }
  }

  return null;
}

export function resolveFileDocumentImagePreview(input: {
  attachmentStorageKeyBySlotId: AttachmentStorageKeyBySlotId;
  attachments: ReadonlyArray<DocumentAttachment>;
  imageUrlBySlotId: AttachmentImageUrlBySlotId;
}): FileDocumentImagePreview | null {
  const attachment = resolveLocalFileDocumentAttachment(
    input.attachments,
    input.attachmentStorageKeyBySlotId,
  );

  if (
    !attachment ||
    !isRenderableFileDocumentImageMimeType(attachment.mimeType)
  ) {
    return null;
  }

  return {
    attachment,
    imageUrl: input.imageUrlBySlotId[attachment.slotId] ?? null,
  };
}

export function useFileDocumentImagePreview(params: {
  attachmentStorageKeyBySlotId: AttachmentStorageKeyBySlotId;
  attachments: ReadonlyArray<DocumentAttachment>;
  blobStore: BlobStore;
}): FileDocumentImagePreview | null {
  const { attachmentStorageKeyBySlotId, attachments, blobStore } = params;
  const imagePreviewCandidate = useMemo(
    () =>
      resolveFileDocumentImagePreview({
        attachments,
        attachmentStorageKeyBySlotId,
        imageUrlBySlotId: {},
      }),
    [attachments, attachmentStorageKeyBySlotId],
  );
  const previewAttachments = useMemo(
    () => (imagePreviewCandidate ? [imagePreviewCandidate.attachment] : []),
    [imagePreviewCandidate],
  );
  const imageUrlBySlotId = useAttachmentImageUrls(
    previewAttachments,
    attachmentStorageKeyBySlotId,
    blobStore,
  );

  return useMemo(
    () =>
      imagePreviewCandidate
        ? {
            attachment: imagePreviewCandidate.attachment,
            imageUrl:
              imageUrlBySlotId[imagePreviewCandidate.attachment.slotId] ?? null,
          }
        : null,
    [imagePreviewCandidate, imageUrlBySlotId],
  );
}

export function FileDocumentImagePreviewPanel(params: {
  preview: FileDocumentImagePreview;
}) {
  const { attachment, imageUrl } = params.preview;
  return (
    <section className="file-document-preview" aria-label="File preview">
      <div
        aria-busy={!imageUrl || undefined}
        className="file-document-preview-frame"
      >
        {imageUrl ? (
          <img
            className="file-document-image-preview"
            src={imageUrl}
            alt={attachment.name}
          />
        ) : (
          <span className="structured-document-slot-description">
            Loading image...
          </span>
        )}
      </div>
    </section>
  );
}

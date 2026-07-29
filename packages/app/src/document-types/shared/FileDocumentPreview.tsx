import type { BlobStore, DocumentAttachment } from "@tearleads/client-sdk";
import { useEffect, useMemo, useState } from "react";
import { MiniAppImageViewer } from "../../components/mini-app/MiniAppLayout";
import { isAutomaticBlobPreviewAllowed } from "./documentAttachmentUtils";
import {
  getMediaPreviewKind,
  isPreviewableMediaMimeType,
  MediaPreview,
  type MediaPreviewKind,
} from "./MediaPreview";

export interface FileDocumentMediaPreview {
  attachment: DocumentAttachment;
  mediaKind: MediaPreviewKind;
  mediaUrl: string | null;
}

type AttachmentStorageKeyBySlotId = Readonly<Record<string, string>>;

export function isRenderableFileDocumentMediaMimeType(
  mimeType: string | null | undefined,
): boolean {
  return isPreviewableMediaMimeType(mimeType);
}

function resolveLocalFileDocumentMediaAttachment(
  attachments: ReadonlyArray<DocumentAttachment>,
  attachmentStorageKeyBySlotId: AttachmentStorageKeyBySlotId,
): DocumentAttachment | null {
  for (let index = attachments.length - 1; index >= 0; index -= 1) {
    const attachment = attachments[index];
    if (
      attachment &&
      attachmentStorageKeyBySlotId[attachment.slotId] &&
      isAutomaticBlobPreviewAllowed(attachment) &&
      isRenderableFileDocumentMediaMimeType(attachment.mimeType)
    ) {
      return attachment;
    }
  }

  return null;
}

export function resolveFileDocumentMediaPreview(input: {
  attachmentStorageKeyBySlotId: AttachmentStorageKeyBySlotId;
  attachments: ReadonlyArray<DocumentAttachment>;
  mediaUrlBySlotId: Readonly<Record<string, string | undefined>>;
}): FileDocumentMediaPreview | null {
  const attachment = resolveLocalFileDocumentMediaAttachment(
    input.attachments,
    input.attachmentStorageKeyBySlotId,
  );
  const mediaKind = getMediaPreviewKind(attachment?.mimeType);

  if (!attachment || !mediaKind) {
    return null;
  }

  return {
    attachment,
    mediaKind,
    mediaUrl: input.mediaUrlBySlotId[attachment.slotId] ?? null,
  };
}

function useAttachmentMediaUrl(params: {
  blobStore: BlobStore;
  mimeType: string | null | undefined;
  storageKey: string | null;
}): string | null {
  const { blobStore, mimeType, storageKey } = params;
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!storageKey) {
      setMediaUrl(null);
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;

    setMediaUrl(null);
    void blobStore
      .readBytes(storageKey)
      .then((bytes) => {
        if (!bytes || cancelled) {
          return;
        }

        objectUrl = URL.createObjectURL(
          new Blob([bytes], {
            type: mimeType ?? "application/octet-stream",
          }),
        );
        setMediaUrl(objectUrl);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          console.error("Failed to load file preview:", error);
          setMediaUrl(null);
        }
      });

    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [blobStore, mimeType, storageKey]);

  return mediaUrl;
}

export function useFileDocumentMediaPreview(params: {
  attachmentStorageKeyBySlotId: AttachmentStorageKeyBySlotId;
  attachments: ReadonlyArray<DocumentAttachment>;
  blobStore: BlobStore;
}): FileDocumentMediaPreview | null {
  const { attachmentStorageKeyBySlotId, attachments, blobStore } = params;
  const mediaPreviewCandidate = useMemo(
    () =>
      resolveFileDocumentMediaPreview({
        attachments,
        attachmentStorageKeyBySlotId,
        mediaUrlBySlotId: {},
      }),
    [attachments, attachmentStorageKeyBySlotId],
  );
  const storageKey = mediaPreviewCandidate
    ? (attachmentStorageKeyBySlotId[mediaPreviewCandidate.attachment.slotId] ??
      null)
    : null;
  const mediaUrl = useAttachmentMediaUrl({
    blobStore,
    mimeType: mediaPreviewCandidate?.attachment.mimeType,
    storageKey,
  });

  return useMemo(
    () =>
      mediaPreviewCandidate
        ? {
            attachment: mediaPreviewCandidate.attachment,
            mediaKind: mediaPreviewCandidate.mediaKind,
            mediaUrl,
          }
        : null,
    [mediaPreviewCandidate, mediaUrl],
  );
}

export function FileDocumentMediaPreviewPanel(params: {
  onDownload?: (() => void) | undefined;
  preview: FileDocumentMediaPreview;
}) {
  const { attachment, mediaKind, mediaUrl } = params.preview;
  const [viewerOpen, setViewerOpen] = useState(false);
  const imageCanOpen = mediaKind === "image" && mediaUrl !== null;

  return (
    <>
      <section className="file-document-preview" aria-label="File preview">
        <div
          aria-busy={!mediaUrl || undefined}
          className="file-document-preview-frame"
        >
          {mediaUrl ? (
            imageCanOpen ? (
              <button
                aria-label="Open full screen"
                className="file-document-preview-open"
                onClick={() => setViewerOpen(true)}
                title="Open full screen"
                type="button"
              >
                <MediaPreview
                  className="file-document-media-preview"
                  kind={mediaKind}
                  label={attachment.name}
                  url={mediaUrl}
                />
              </button>
            ) : (
              <MediaPreview
                className="file-document-media-preview"
                kind={mediaKind}
                label={attachment.name}
                url={mediaUrl}
              />
            )
          ) : (
            <span className="structured-document-slot-description">
              Loading preview...
            </span>
          )}
        </div>
      </section>
      {viewerOpen && imageCanOpen ? (
        <MiniAppImageViewer
          label={attachment.name}
          onClose={() => setViewerOpen(false)}
          onDownload={params.onDownload}
          url={mediaUrl}
        />
      ) : null}
    </>
  );
}

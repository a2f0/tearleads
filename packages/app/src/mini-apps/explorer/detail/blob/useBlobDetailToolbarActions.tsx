import { ArrowsOutIcon } from "@phosphor-icons/react/dist/csr/ArrowsOut";
import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import type { BlobInfo } from "@tearleads/client-sdk";
import { useCallback, useMemo, useState } from "react";
import { useWindowTitleBarAction } from "../../../../components/window/WindowMenuContext";
import { getMediaPreviewKind } from "../../../../document-types/shared/MediaPreview";
import type { BlobPreviewState } from "../../../shared/blob-pick/blob-list/blobPreview";
import { EXPLORER_LABELS } from "../../labels";

// Open sits left of Download, and both sit left of the hub's persistent Sync
// entry point (priority 50 — the toolbar orders highest priority first).
const BLOB_OPEN_ACTION_PRIORITY = 150;
const BLOB_DOWNLOAD_ACTION_PRIORITY = 140;

export function getBlobDisplayName(blob: BlobInfo): string {
  return blob.name ?? blob.blobId ?? blob.storageKey;
}

/**
 * The blob detail screen's chrome: Open and Download, registered on the window
 * toolbar (and so on the routed shell's app bar too) rather than drawn inside
 * the panel, plus the full-screen viewer Open hands an image to.
 *
 * Opening an image used to mean `window.open` on a blob: URL, which a phone
 * either blocks or dumps into a bare browser tab. Images now open in-app
 * instead; everything else (PDFs, video, text) keeps the new-tab behavior, which
 * is still the only sensible viewer this app has for them.
 */
export function useBlobDetailToolbarActions(params: {
  blob: BlobInfo | null;
  onDownload: (blob: BlobInfo) => void;
  preview: BlobPreviewState;
}) {
  const { blob, onDownload } = params;
  const previewUrl =
    params.preview.status === "ready" ? params.preview.url : null;
  const isImage = getMediaPreviewKind(blob?.mimeType) === "image";
  const [openedUrl, setOpenedUrl] = useState<string | null>(null);
  // The viewer is tied to the exact URL it was opened with. Selecting another
  // blob (or reloading this one's preview) revokes that object URL, and matching
  // on it closes the viewer in the same beat rather than stranding a dead image
  // over the screen.
  const viewerUrl =
    openedUrl !== null && openedUrl === previewUrl ? openedUrl : null;

  const handleOpen = useCallback(() => {
    if (!previewUrl) {
      return;
    }
    if (isImage) {
      setOpenedUrl(previewUrl);
      return;
    }
    window.open(previewUrl, "_blank", "noopener,noreferrer");
  }, [isImage, previewUrl]);

  const handleDownload = useCallback(() => {
    if (blob) {
      onDownload(blob);
    }
  }, [blob, onDownload]);

  const openAction = useMemo(
    () =>
      blob
        ? {
            // Nothing to open until the preview has produced a URL: a blob whose
            // bytes are not on this device, or one too large to preview inline.
            disabled: previewUrl === null,
            icon: <ArrowsOutIcon aria-hidden size={18} />,
            id: "explorer-blob-open",
            label: EXPLORER_LABELS.blobBrowserOpenBlobAction,
            onClick: handleOpen,
            priority: BLOB_OPEN_ACTION_PRIORITY,
          }
        : null,
    [blob, handleOpen, previewUrl],
  );
  // Download reads the stored bytes directly, so it stays available even when
  // there is no preview to open.
  const downloadAction = useMemo(
    () =>
      blob
        ? {
            icon: <DownloadSimpleIcon aria-hidden size={18} />,
            id: "explorer-blob-download",
            label: EXPLORER_LABELS.blobBrowserDownloadAction,
            onClick: handleDownload,
            priority: BLOB_DOWNLOAD_ACTION_PRIORITY,
          }
        : null,
    [blob, handleDownload],
  );

  useWindowTitleBarAction(openAction);
  useWindowTitleBarAction(downloadAction);

  return {
    closeViewer: useCallback(() => setOpenedUrl(null), []),
    handleDownload,
    // The inline preview wires this to the picture itself, so tapping the image
    // is a way into the viewer alongside the toolbar's expand control. Null for
    // anything the viewer cannot show — audio and video own their own tap
    // (play/pause, scrub), and a blob with no local bytes has nothing to open.
    openImage: isImage && previewUrl !== null ? handleOpen : null,
    viewerUrl,
  };
}

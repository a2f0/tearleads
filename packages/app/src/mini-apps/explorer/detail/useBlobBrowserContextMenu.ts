import type { BlobInfo, BlobStore } from "@tearleads/client-sdk";
import { type MouseEvent, useCallback, useState } from "react";
import type { MenuPosition } from "../../../components/shared/Menu";
import { downloadBytesAsFile } from "../../../utils/downloadFile";
import { unknownErrorMessage } from "../../../utils/unknownErrorMessage";
import { EXPLORER_LABELS } from "../labels";

interface BlobContextMenuState {
  blob: BlobInfo;
  position: MenuPosition;
}

// Blobs frequently carry no name, so fall back to the blob id / storage key for
// the downloaded file's name.
function getBlobDownloadFileName(blob: BlobInfo): string {
  return blob.name?.trim() || blob.blobId || blob.storageKey;
}

// Read a blob's local bytes and hand them to the browser. Returns false when the
// bytes are not present locally (e.g. a blob that has not synced down to this
// device), so callers can surface an "unavailable" message instead of failing
// silently.
async function downloadBlobBytes(input: {
  blob: BlobInfo;
  blobStore: BlobStore;
}): Promise<boolean> {
  const bytes = await input.blobStore.readBytes(input.blob.storageKey);
  if (!bytes) {
    return false;
  }
  downloadBytesAsFile({
    bytes,
    fileName: getBlobDownloadFileName(input.blob),
    mimeType: input.blob.mimeType,
  });
  return true;
}

// Owns the blob-browser row context menu: the right-click position + target
// blob, the download action, and the inline message shown when a download
// cannot complete (bytes missing locally or a read failure).
export function useBlobBrowserContextMenu(params: { blobStore: BlobStore }) {
  const { blobStore } = params;
  const [contextMenu, setContextMenu] = useState<BlobContextMenuState | null>(
    null,
  );
  const [downloadMessage, setDownloadMessage] = useState<string | null>(null);

  const openContextMenu = useCallback(
    (event: MouseEvent<HTMLElement>, blob: BlobInfo) => {
      event.preventDefault();
      setDownloadMessage(null);
      setContextMenu({
        blob,
        position: { x: event.clientX, y: event.clientY },
      });
    },
    [],
  );

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const downloadBlob = useCallback(
    (blob: BlobInfo) => {
      void (async () => {
        try {
          const downloaded = await downloadBlobBytes({ blob, blobStore });
          setDownloadMessage(
            downloaded ? null : EXPLORER_LABELS.blobBrowserLocalBytesMissing,
          );
        } catch (error) {
          // A failed blob read must not surface as an unhandled rejection.
          setDownloadMessage(unknownErrorMessage(error));
        }
      })();
    },
    [blobStore],
  );

  return {
    closeContextMenu,
    contextMenu,
    downloadBlob,
    downloadMessage,
    openContextMenu,
  };
}

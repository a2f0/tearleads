import type { BlobInfo, BlobStore, FileSaver } from "@symcrypt/client-sdk";
import { useCallback, useEffect, useRef, useState } from "react";
import { useContextMenuState } from "../../../../components/shared/useContextMenuState";
import { useFileSaver } from "../../../../providers/file-saver/FileSaverProvider";
import { downloadBytesAsFile } from "../../../../utils/downloadFile";
import { unknownErrorMessage } from "../../../../utils/unknownErrorMessage";
import { EXPLORER_LABELS } from "../../labels";

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
  fileSaver: FileSaver;
}): Promise<boolean> {
  const bytes = await input.blobStore.readBytes(input.blob.storageKey);
  if (!bytes) {
    return false;
  }
  await downloadBytesAsFile(input.fileSaver, {
    bytes,
    fileName: getBlobDownloadFileName(input.blob),
    mimeType: input.blob.mimeType,
  });
  return true;
}

// Owns the blob-browser row context menu: the target blob (via the shared
// context-menu state), the download action, and the inline message shown when a
// download cannot complete (bytes missing locally or a read failure).
export function useBlobBrowserContextMenu(params: {
  blobStore: BlobStore;
  query: string;
  selectedBlob: BlobInfo | null;
}) {
  const { blobStore, query, selectedBlob } = params;
  const fileSaver = useFileSaver();
  const [downloadMessage, setDownloadMessage] = useState<string | null>(null);
  // Monotonic id of the most recently started download. A slower earlier read
  // that resolves after a newer one must not overwrite the newer one's status.
  const downloadRequestRef = useRef(0);
  const clearDownloadMessage = useCallback(() => setDownloadMessage(null), []);

  // Reuse the shared context-menu state so a row right-click both suppresses the
  // native menu and stops bubbling to the pane's own context menu. Opening the
  // menu also clears any prior download note.
  const { closeContextMenu, contextMenu, openContextMenu } =
    useContextMenuState<BlobInfo>({ onOpen: clearDownloadMessage });

  // A stale download message must not linger once the user moves on, so clear
  // it when the search query or the selected blob changes. Bumping the request
  // id also invalidates any in-flight download so its late result cannot
  // re-show a message after the user has navigated away.
  useEffect(() => {
    clearDownloadMessage();
    downloadRequestRef.current += 1;
  }, [query, selectedBlob, clearDownloadMessage]);

  const downloadBlob = useCallback(
    (blob: BlobInfo) => {
      downloadRequestRef.current += 1;
      const requestId = downloadRequestRef.current;
      void (async () => {
        try {
          const downloaded = await downloadBlobBytes({
            blob,
            blobStore,
            fileSaver,
          });
          if (downloadRequestRef.current === requestId) {
            setDownloadMessage(
              downloaded ? null : EXPLORER_LABELS.blobBrowserLocalBytesMissing,
            );
          }
        } catch (error) {
          // A failed blob read must not surface as an unhandled rejection.
          if (downloadRequestRef.current === requestId) {
            setDownloadMessage(unknownErrorMessage(error));
          }
        }
      })();
    },
    [blobStore, fileSaver],
  );

  return {
    closeContextMenu,
    contextMenu,
    downloadBlob,
    downloadMessage,
    openContextMenu,
  };
}

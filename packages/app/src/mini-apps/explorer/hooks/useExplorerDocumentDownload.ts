import type { BlobStore, DocumentInfo } from "@tearleads/client-sdk";
import { useCallback } from "react";
import { downloadResolvedAttachment } from "../../../document-types/shared/fileDownload";
import { useFileSaver } from "../../../providers/file-saver/FileSaverProvider";

// The explorer context-menu "Download" for a file document: resolve the file's
// most recent attachment that has local bytes, then hand them to the platform
// file saver. loadDocumentInfo reads only local state when offline, so a
// context-menu download never blocks on the network. A failed info load / blob
// read has no surface of its own — the detail-pane Download button carries the
// visible error affordance for the same failure — so it is reported through
// diagnostics rather than surfaced as an unhandled rejection.
export function useExplorerDocumentDownload(params: {
  blobStore: BlobStore;
  loadDocumentInfo: (localId: string) => Promise<DocumentInfo>;
  logError: (message: string | Error, cause?: unknown) => void;
}): (localId: string) => void {
  const { blobStore, loadDocumentInfo, logError } = params;
  const fileSaver = useFileSaver();
  return useCallback(
    (localId: string) => {
      void (async () => {
        try {
          const info = await loadDocumentInfo(localId);
          const attachment = [...info.attachments]
            .reverse()
            .find((candidate) => candidate.storageKey.length > 0);
          if (!attachment) {
            return;
          }
          await downloadResolvedAttachment({
            attachment: {
              mimeType: attachment.mimeType,
              name: attachment.name,
              storageKey: attachment.storageKey,
            },
            blobStore,
            fallbackFileName: attachment.name?.trim() || localId,
            fileSaver,
          });
        } catch (error) {
          logError("Failed to download the explorer document", error);
        }
      })();
    },
    [blobStore, fileSaver, loadDocumentInfo, logError],
  );
}

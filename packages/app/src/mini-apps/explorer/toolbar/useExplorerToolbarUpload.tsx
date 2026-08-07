import { type ChangeEvent, useCallback, useRef } from "react";
import type { ExplorerUploadManager } from "../hooks/useExplorerUploadManager";

// The hidden file <input> behind Explorer's Upload toolbar action, plus the
// trigger that opens the picker for a given container. Kept as a standalone hook
// so ExplorerRoutedChrome stays focused on registering toolbar/menu actions.
export function useExplorerToolbarUpload(
  uploadManager: Pick<ExplorerUploadManager, "startImport">,
) {
  const { startImport } = uploadManager;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadContainerIdRef = useRef<string | null>(null);

  const triggerUpload = useCallback((containerId: string) => {
    uploadContainerIdRef.current = containerId;
    fileInputRef.current?.click();
  }, []);

  const handleUploadChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      const uploadContainerId = uploadContainerIdRef.current;
      try {
        if (files.length > 0 && uploadContainerId) {
          startImport(uploadContainerId, files);
        }
      } finally {
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
        uploadContainerIdRef.current = null;
      }
    },
    [startImport],
  );

  return {
    input: (
      <input
        ref={fileInputRef}
        className="explorer-file-input"
        style={{ display: "none" }}
        type="file"
        multiple
        onChange={handleUploadChange}
      />
    ),
    triggerUpload,
  };
}

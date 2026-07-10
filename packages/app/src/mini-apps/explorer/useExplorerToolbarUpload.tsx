import { type ChangeEvent, useCallback, useRef } from "react";
import type { ImportExplorerDroppedFiles } from "../../stores/explorer/useExplorerDroppedFileImport";

// The hidden file <input> behind Explorer's Upload toolbar action, plus the
// trigger that opens the picker for a given container. Kept as a standalone hook
// so ExplorerRoutedChrome stays focused on registering toolbar/menu actions.
export function useExplorerToolbarUpload(
  importDroppedFiles: ImportExplorerDroppedFiles,
) {
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
          void importDroppedFiles(uploadContainerId, files).catch(() => {
            // The importer logs per-file failures; keep toolbar uploads from
            // surfacing exceptional rejections as unhandled.
          });
        }
      } finally {
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
        uploadContainerIdRef.current = null;
      }
    },
    [importDroppedFiles],
  );

  return {
    input: (
      <input
        ref={fileInputRef}
        className="explorer-toolbar-file-input"
        style={{ display: "none" }}
        type="file"
        multiple
        onChange={handleUploadChange}
      />
    ),
    triggerUpload,
  };
}

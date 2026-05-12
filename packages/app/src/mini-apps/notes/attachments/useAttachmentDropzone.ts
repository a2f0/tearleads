import { type DragEvent, useCallback, useState } from "react";
import type { NotesHandleSelectedFiles } from "../types";

export function useAttachmentDropzone(
  canAttach: boolean,
  handleSelectedFiles: NotesHandleSelectedFiles,
) {
  const [dragActive, setDragActive] = useState(false);

  const activateDropzone = useCallback(
    (event: DragEvent<HTMLLabelElement>) => {
      if (!canAttach) {
        return;
      }

      event.preventDefault();
      setDragActive(true);
    },
    [canAttach],
  );

  const handleDragLeave = useCallback((event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragActive(false);
  }, []);

  const handleDrop = useCallback(
    (event: DragEvent<HTMLLabelElement>) => {
      event.preventDefault();
      setDragActive(false);
      if (!canAttach) {
        return;
      }

      void handleSelectedFiles(event.dataTransfer.files);
    },
    [canAttach, handleSelectedFiles],
  );

  return {
    dragActive,
    handleDragEnter: activateDropzone,
    handleDragLeave,
    handleDragOver: activateDropzone,
    handleDrop,
  };
}

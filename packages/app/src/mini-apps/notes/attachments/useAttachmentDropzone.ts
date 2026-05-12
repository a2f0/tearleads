import { type DragEvent, useState } from "react";
import type { NotesHandleSelectedFiles } from "../types";

export function useAttachmentDropzone(
  canAttach: boolean,
  handleSelectedFiles: NotesHandleSelectedFiles,
) {
  const [dragActive, setDragActive] = useState(false);

  function activateDropzone(event: DragEvent<HTMLLabelElement>) {
    if (!canAttach) {
      return;
    }

    event.preventDefault();
    setDragActive(true);
  }

  function handleDragLeave(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragActive(false);
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragActive(false);
    if (!canAttach) {
      return;
    }

    void handleSelectedFiles(event.dataTransfer.files);
  }

  return {
    dragActive,
    handleDragEnter: activateDropzone,
    handleDragLeave,
    handleDragOver: activateDropzone,
    handleDrop,
  };
}

import type { ContainerNode } from "@tearleads/client-sdk";
import { type DragEvent, useCallback, useRef, useState } from "react";
import { EXPLORER_LABELS } from "../labels";
import {
  type ExplorerFileImportRun,
  getExplorerFileImportRunStatusText,
} from "./useExplorerFileImportRun";

function isExplorerFileDragEvent(event: DragEvent<HTMLElement>): boolean {
  return Array.from(event.dataTransfer.types).includes("Files");
}

function getExplorerDropFiles(event: DragEvent<HTMLElement>): File[] {
  return Array.from(event.dataTransfer.files);
}

// Drag-and-drop plumbing for a container detail panel. The import run itself
// (progress, cancellation, terminal status) lives in the shared
// ExplorerFileImportRun; this hook only owns the drag state and hands dropped
// files to that run.
export function useExplorerContainerFileDropTarget(params: {
  fileImportRun: ExplorerFileImportRun;
  selectedNode: ContainerNode;
}) {
  const { fileImportRun, selectedNode } = params;
  const { isImporting, startImport } = fileImportRun;
  const dragDepthRef = useRef(0);
  const [dragActive, setDragActive] = useState(false);

  const resetDragState = useCallback(() => {
    dragDepthRef.current = 0;
    setDragActive(false);
  }, []);

  const handleDragEnter = useCallback((event: DragEvent<HTMLElement>) => {
    if (!isExplorerFileDragEvent(event)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current += 1;
    setDragActive(true);
  }, []);

  const handleDragLeave = useCallback((event: DragEvent<HTMLElement>) => {
    if (!isExplorerFileDragEvent(event)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setDragActive(false);
    }
  }, []);

  const handleDragOver = useCallback(
    (event: DragEvent<HTMLElement>) => {
      if (!isExplorerFileDragEvent(event)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = isImporting ? "none" : "copy";
    },
    [isImporting],
  );

  const handleDrop = useCallback(
    (event: DragEvent<HTMLElement>) => {
      if (!isExplorerFileDragEvent(event)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      resetDragState();

      const files = getExplorerDropFiles(event);
      if (files.length === 0 || isImporting) {
        return;
      }

      startImport(selectedNode.id, files);
    },
    [isImporting, resetDragState, selectedNode.id, startImport],
  );

  return {
    dragActive,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    importStatus:
      dragActive && !isImporting
        ? EXPLORER_LABELS.fileDropHint
        : getExplorerFileImportRunStatusText(fileImportRun.run),
    importStatusIsError: fileImportRun.run?.status === "failed",
    isImporting,
  };
}

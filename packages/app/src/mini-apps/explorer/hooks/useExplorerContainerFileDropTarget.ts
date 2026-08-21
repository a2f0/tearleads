import type { ContainerNode } from "@symcrypt/client-sdk";
import { type DragEvent, useCallback, useRef, useState } from "react";
import { EXPLORER_LABELS, getExplorerUploadsWaitingStatus } from "../labels";
import { getExplorerUploadStatusText } from "./explorerUploadState";
import type { ExplorerUploadManager } from "./useExplorerUploadManager";

function isExplorerFileDragEvent(event: DragEvent<HTMLElement>): boolean {
  return Array.from(event.dataTransfer.types).includes("Files");
}

function getExplorerDropFiles(event: DragEvent<HTMLElement>): File[] {
  return Array.from(event.dataTransfer.files);
}

// Drag-and-drop plumbing for a container detail panel. The upload lifecycle
// (queueing, progress, cancellation, terminal status) lives in the shared
// ExplorerUploadManager; this hook only owns the drag state and hands dropped
// files to that manager — a drop during an active import simply enqueues.
export function useExplorerContainerFileDropTarget(params: {
  selectedNode: ContainerNode;
  uploadManager: ExplorerUploadManager;
}) {
  const { selectedNode, uploadManager } = params;
  const { cancelForContainer, startImport } = uploadManager;
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

  const handleDragOver = useCallback((event: DragEvent<HTMLElement>) => {
    if (!isExplorerFileDragEvent(event)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const handleDrop = useCallback(
    (event: DragEvent<HTMLElement>) => {
      if (!isExplorerFileDragEvent(event)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      resetDragState();

      const files = getExplorerDropFiles(event);
      if (files.length === 0) {
        return;
      }

      startImport(selectedNode.id, files);
    },
    [resetDragState, selectedNode.id, startImport],
  );

  // Scope everything to THIS container: another folder's detail never shows a
  // foreign import's progress or stale result, and a folder with files waiting
  // behind another container's active run still reports them.
  const scopedRun =
    uploadManager.run?.containerId === selectedNode.id
      ? uploadManager.run
      : null;
  const scopedImporting = uploadManager.isImporting && scopedRun !== null;
  const scopedQueuedCount =
    uploadManager.queuedFileCounts.get(selectedNode.id) ?? 0;
  // The button this gates cancels THIS container's uploads only, so it may
  // appear whenever the folder has anything outstanding — queued or running.
  const cancelImport = useCallback(() => {
    cancelForContainer(selectedNode.id);
  }, [cancelForContainer, selectedNode.id]);

  return {
    canCancelImport: scopedImporting || scopedQueuedCount > 0,
    cancelImport,
    dragActive,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    importStatus: dragActive
      ? EXPLORER_LABELS.fileDropHint
      : (getExplorerUploadStatusText(scopedRun, scopedQueuedCount) ??
        (scopedQueuedCount > 0
          ? getExplorerUploadsWaitingStatus(scopedQueuedCount)
          : null)),
    importStatusIsError: scopedRun?.status === "failed",
    isImporting: scopedImporting,
  };
}

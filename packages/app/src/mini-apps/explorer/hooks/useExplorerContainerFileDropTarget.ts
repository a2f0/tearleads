import type { ContainerNode } from "@tearleads/client-sdk";
import { type DragEvent, useCallback, useRef, useState } from "react";
import type {
  ExplorerDroppedFileImportProgress,
  ImportExplorerDroppedFiles,
} from "../../../stores/explorer/useExplorerDroppedFileImport";
import {
  EXPLORER_LABELS,
  getExplorerFileImportCompletedStatus,
  getExplorerFileImportingStatus,
  getExplorerFileImportPartialStatus,
} from "../labels";

function isExplorerFileDragEvent(event: DragEvent<HTMLElement>): boolean {
  return Array.from(event.dataTransfer.types).includes("Files");
}

function getExplorerDropFiles(event: DragEvent<HTMLElement>): File[] {
  return Array.from(event.dataTransfer.files);
}

function getExplorerImportProgressStatus(
  progress: ExplorerDroppedFileImportProgress | null,
): string | null {
  if (!progress || progress.totalCount === 0) {
    return null;
  }

  if (progress.completedCount < progress.totalCount) {
    return getExplorerFileImportingStatus(progress);
  }

  if (progress.failedCount > 0) {
    return getExplorerFileImportPartialStatus(progress);
  }

  return getExplorerFileImportCompletedStatus(progress.importedCount);
}

function createExplorerImportProgress(
  totalCount: number,
): ExplorerDroppedFileImportProgress {
  return {
    completedCount: 0,
    failedCount: 0,
    importedCount: 0,
    totalCount,
  };
}

function startExplorerDroppedFileImport(input: {
  files: ReadonlyArray<File>;
  importDroppedFiles: ImportExplorerDroppedFiles;
  selectedNode: ContainerNode;
  setImportError: (error: string | null) => void;
  setImportProgress: (
    progress: ExplorerDroppedFileImportProgress | null,
  ) => void;
  setIsImporting: (isImporting: boolean) => void;
}) {
  input.setImportError(null);
  input.setImportProgress(createExplorerImportProgress(input.files.length));
  input.setIsImporting(true);
  void input
    .importDroppedFiles(
      input.selectedNode.id,
      input.files,
      input.setImportProgress,
    )
    .then((result) => {
      input.setImportProgress(result);
      if (result.failedCount > 0) {
        input.setImportError(EXPLORER_LABELS.fileImportFailedStatus);
      }
    })
    .catch((error: unknown) => {
      input.setImportError(
        error instanceof Error
          ? error.message
          : EXPLORER_LABELS.fileImportGenericFailure,
      );
    })
    .finally(() => {
      input.setIsImporting(false);
    });
}

export function useExplorerContainerFileDropTarget(params: {
  importDroppedFiles: ImportExplorerDroppedFiles;
  selectedNode: ContainerNode;
}) {
  const { importDroppedFiles, selectedNode } = params;
  const dragDepthRef = useRef(0);
  const [dragActive, setDragActive] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importProgress, setImportProgress] =
    useState<ExplorerDroppedFileImportProgress | null>(null);
  const [isImporting, setIsImporting] = useState(false);

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

      startExplorerDroppedFileImport({
        files,
        importDroppedFiles,
        selectedNode,
        setImportError,
        setImportProgress,
        setIsImporting,
      });
    },
    [importDroppedFiles, isImporting, resetDragState, selectedNode.id],
  );

  return {
    dragActive,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    importStatus:
      importError ??
      (dragActive && !isImporting
        ? EXPLORER_LABELS.fileDropHint
        : getExplorerImportProgressStatus(importProgress)),
    importStatusIsError: importError !== null,
    isImporting,
  };
}

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ExplorerDroppedFileImportProgress,
  ImportExplorerDroppedFiles,
} from "../../../stores/explorer/useExplorerDroppedFileImport";
import {
  EXPLORER_LABELS,
  getExplorerFileImportCancelledStatus,
  getExplorerFileImportCompletedStatus,
  getExplorerFileImportingStatus,
  getExplorerFileImportPartialStatus,
} from "../labels";

// A file-import run moves through exactly one of these terminal states after
// "running": done (every file imported), cancelled (the user stopped it — the
// already-imported prefix stays), or failed (the run was refused outright, or
// some files could not be imported).
export type ExplorerFileImportRunStatus =
  | "running"
  | "done"
  | "cancelled"
  | "failed";

export interface ExplorerFileImportRunState {
  containerId: string;
  error: string | null;
  progress: ExplorerDroppedFileImportProgress;
  status: ExplorerFileImportRunStatus;
}

export interface ExplorerFileImportRun {
  cancel: () => void;
  isImporting: boolean;
  run: ExplorerFileImportRunState | null;
  startImport: (containerId: string, files: ReadonlyArray<File>) => void;
}

// The single status line for a run. null hides the line (no run yet).
export function getExplorerFileImportRunStatusText(
  run: ExplorerFileImportRunState | null,
): string | null {
  if (!run || run.progress.totalCount === 0) {
    return null;
  }
  switch (run.status) {
    case "running":
      return getExplorerFileImportingStatus(run.progress);
    case "done":
      return getExplorerFileImportCompletedStatus(run.progress.importedCount);
    case "cancelled":
      return getExplorerFileImportCancelledStatus(run.progress);
    case "failed":
      return run.error ?? getExplorerFileImportPartialStatus(run.progress);
  }
}

// A fresh progress object each tick, applied only while still running so a late
// callback can't overwrite an already-terminal state.
function importRunWithProgress(
  current: ExplorerFileImportRunState | null,
  progress: ExplorerDroppedFileImportProgress,
): ExplorerFileImportRunState | null {
  return current && current.status === "running"
    ? { ...current, progress }
    : current;
}

// Resolve the terminal state once the import promise settles: a user-cancelled
// run is "cancelled"; a clean run with no failed files is "done"; anything else
// (per-file failures, an outright rejection) is "failed". The settled result's
// own counts win over the last onProgress tick so the terminal line is exact.
function settledImportRun(
  current: ExplorerFileImportRunState | null,
  input: {
    aborted: boolean;
    error: string | null;
    failedCount: number;
    progress?: ExplorerDroppedFileImportProgress;
  },
): ExplorerFileImportRunState | null {
  if (!current) {
    return current;
  }
  const progress = input.progress ?? current.progress;
  if (input.aborted) {
    return { ...current, error: null, progress, status: "cancelled" };
  }
  if (input.error === null && input.failedCount === 0) {
    return { ...current, error: null, progress, status: "done" };
  }
  return { ...current, error: input.error, progress, status: "failed" };
}

// Owns the lifecycle of one explorer file-import run: the live progress, the
// AbortController for cancellation, and the terminal status the container
// detail's status line renders. All three upload entry points (toolbar Upload,
// drag-and-drop, the folder context menu) start their imports here so a bulk
// upload is visible and cancellable no matter how it began.
export function useExplorerFileImportRun(params: {
  importDroppedFiles: ImportExplorerDroppedFiles;
}): ExplorerFileImportRun {
  const { importDroppedFiles } = params;
  const [run, setRun] = useState<ExplorerFileImportRunState | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const runningRef = useRef(false);
  // Abort any in-flight import on unmount so it can't keep creating documents
  // with no UI reporting on it.
  useEffect(() => () => abortRef.current?.abort(), []);

  const startImport = useCallback(
    (containerId: string, files: ReadonlyArray<File>) => {
      // Single-slot, like the purge run: the entry points share one status
      // line, so a second start while one runs is ignored, not interleaved.
      if (runningRef.current || files.length === 0) {
        return;
      }

      const controller = new AbortController();
      abortRef.current = controller;
      runningRef.current = true;
      setRun({
        containerId,
        error: null,
        progress: {
          completedCount: 0,
          failedCount: 0,
          importedCount: 0,
          totalCount: files.length,
        },
        status: "running",
      });

      void importDroppedFiles(containerId, files, {
        onProgress: (progress) => {
          setRun((current) => importRunWithProgress(current, progress));
        },
        signal: controller.signal,
      })
        .then((result) => {
          setRun((current) =>
            settledImportRun(current, {
              aborted: result.aborted,
              error: null,
              failedCount: result.failedCount,
              progress: {
                completedCount: result.completedCount,
                failedCount: result.failedCount,
                importedCount: result.importedCount,
                totalCount: result.totalCount,
              },
            }),
          );
        })
        .catch((error: unknown) => {
          // A rejection refuses the whole run (e.g. a protected container);
          // per-file failures resolve normally with a failedCount instead.
          setRun((current) =>
            settledImportRun(current, {
              aborted: controller.signal.aborted,
              error:
                error instanceof Error && error.message
                  ? error.message
                  : EXPLORER_LABELS.fileImportGenericFailure,
              failedCount: 0,
            }),
          );
        })
        .finally(() => {
          runningRef.current = false;
          abortRef.current = null;
        });
    },
    [importDroppedFiles],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return {
    cancel,
    isImporting: run?.status === "running",
    run,
    startImport,
  };
}

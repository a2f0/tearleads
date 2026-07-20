import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ExplorerDroppedFileImportResult,
  ExplorerDroppedFileImportRunOptions,
  ImportExplorerDroppedFiles,
} from "../../../stores/explorer/useExplorerDroppedFileImport";
import {
  createUploadItems,
  dropQueuedSelections,
  type ExplorerFileImportRunState,
  type ExplorerUploadItem,
  importRunWithProgress,
  initialSelectionRun,
  isAbortError,
  markOutstandingUploadItems,
  settledImportRun,
  trimRetainedUploadItems,
  type UploadItemsSetter,
  type UploadRunSetter,
  type UploadSelection,
  uploadFailureMessage,
  useQueuedFileCounts,
} from "./explorerUploadState";

export interface ExplorerUploadManager {
  // Cancels everything outstanding across all containers (the Uploads panel).
  cancel: () => void;
  // Cancels only what targets one container: its queued selections, and the
  // active run when it is importing into that container.
  cancelForContainer: (containerId: string) => void;
  isImporting: boolean;
  items: ReadonlyArray<ExplorerUploadItem>;
  // Files in selections that have not started importing yet.
  queuedFileCount: number;
  // The same, broken down by target container (absent key = 0), so a container
  // detail can report what is waiting for THAT folder specifically.
  queuedFileCounts: ReadonlyMap<string, number>;
  // The ACTIVE selection's run (or the last terminal one when idle).
  run: ExplorerFileImportRunState | null;
  startImport: (containerId: string, files: ReadonlyArray<File>) => void;
}

function createSelectionImportOptions(input: {
  pendingSyncKicks: Array<() => void>;
  selection: UploadSelection;
  setItems: UploadItemsSetter;
  setRun: UploadRunSetter;
  signal: AbortSignal;
}): ExplorerDroppedFileImportRunOptions {
  const patchItem = (fileIndex: number, patch: Partial<ExplorerUploadItem>) => {
    const itemId = input.selection.itemIds[fileIndex];
    if (itemId === undefined) {
      return;
    }
    input.setItems((current) =>
      current.map((item) =>
        item.id === itemId ? { ...item, ...patch } : item,
      ),
    );
  };

  return {
    deferRequestSync: true,
    onFileFailed: (fileIndex, error) => {
      patchItem(fileIndex, {
        error: uploadFailureMessage(error),
        status: "failed",
      });
    },
    onFileImported: ({ fileIndex, localId, requestSync }) => {
      input.pendingSyncKicks.push(requestSync);
      patchItem(fileIndex, { localId, status: "imported" });
    },
    onFileStart: (fileIndex) => {
      patchItem(fileIndex, { status: "importing" });
    },
    onProgress: (progress) => {
      input.setRun((current) => importRunWithProgress(current, progress));
    },
    signal: input.signal,
  };
}

// Run one selection through the importer, keeping the run state and per-file
// items current, and fire the deferred sync kicks once it settles — the
// imported prefix syncs even when the selection was cancelled or partially
// failed, because those documents are durable and must reach the server.
async function runUploadSelection(input: {
  controller: AbortController;
  importDroppedFiles: ImportExplorerDroppedFiles;
  selection: UploadSelection;
  setItems: UploadItemsSetter;
  setRun: UploadRunSetter;
}): Promise<void> {
  const { selection, setItems, setRun } = input;
  const pendingSyncKicks: Array<() => void> = [];
  try {
    const result: ExplorerDroppedFileImportResult =
      await input.importDroppedFiles(
        selection.containerId,
        selection.files,
        createSelectionImportOptions({
          pendingSyncKicks,
          selection,
          setItems,
          setRun,
          signal: input.controller.signal,
        }),
      );
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
    if (result.aborted) {
      markOutstandingUploadItems(setItems, selection.itemIds, {
        error: null,
        status: "cancelled",
      });
    }
  } catch (error) {
    // A rejection refuses the whole selection (e.g. a protected container);
    // per-file failures resolve normally with a failedCount instead. A genuine
    // failure that races a user cancel keeps its message — only an actual
    // AbortError counts as the cancel itself.
    const aborted = input.controller.signal.aborted && isAbortError(error);
    const message = uploadFailureMessage(error);
    setRun((current) =>
      settledImportRun(current, { aborted, error: message, failedCount: 0 }),
    );
    markOutstandingUploadItems(
      setItems,
      selection.itemIds,
      aborted
        ? { error: null, status: "cancelled" }
        : { error: message, status: "failed" },
    );
  } finally {
    for (const kick of pendingSyncKicks) {
      kick();
    }
  }
}

// The two cancel affordances: global (the Uploads panel) and per-container
// (a container detail's status line). Both drop matching queued selections
// immediately; a matching ACTIVE run is aborted at its next batch boundary.
function useUploadCancellation(input: {
  abortRef: { current: AbortController | null };
  activeContainerIdRef: { current: string | null };
  selectionQueueRef: { current: UploadSelection[] };
  setItems: UploadItemsSetter;
  syncQueuedFileCount: () => void;
}) {
  const {
    abortRef,
    activeContainerIdRef,
    selectionQueueRef,
    setItems,
    syncQueuedFileCount,
  } = input;

  const cancel = useCallback(() => {
    dropQueuedSelections(selectionQueueRef, setItems, () => true);
    syncQueuedFileCount();
    abortRef.current?.abort();
  }, [abortRef, selectionQueueRef, setItems, syncQueuedFileCount]);

  const cancelForContainer = useCallback(
    (containerId: string) => {
      dropQueuedSelections(
        selectionQueueRef,
        setItems,
        (selection) => selection.containerId === containerId,
      );
      syncQueuedFileCount();
      if (activeContainerIdRef.current === containerId) {
        abortRef.current?.abort();
      }
    },
    [
      abortRef,
      activeContainerIdRef,
      selectionQueueRef,
      setItems,
      syncQueuedFileCount,
    ],
  );

  return { cancel, cancelForContainer };
}

// Owns the explorer upload queue: every upload entry point (toolbar Upload,
// drag-and-drop, the folder context menu) enqueues its selection here, and the
// manager drains one selection at a time through the importer with per-file
// item tracking. Sync kickoff is DEFERRED until a selection settles, so ingest
// writes and sync-lane passes stop contending for the single serialized SQLite
// queue. Cancellation aborts the active selection at its next batch boundary
// and drops every not-yet-started selection.
export function useExplorerUploadManager(params: {
  importDroppedFiles: ImportExplorerDroppedFiles;
}): ExplorerUploadManager {
  const { importDroppedFiles } = params;
  const [run, setRun] = useState<ExplorerFileImportRunState | null>(null);
  const [items, setItems] = useState<ReadonlyArray<ExplorerUploadItem>>([]);
  const selectionQueueRef = useRef<UploadSelection[]>([]);
  const { queuedFileCount, queuedFileCounts, syncQueuedFileCount } =
    useQueuedFileCounts(selectionQueueRef);
  const drainingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const activeContainerIdRef = useRef<string | null>(null);
  const itemSeqRef = useRef(0);
  // Abort any in-flight import on unmount so it can't keep creating documents
  // with no UI reporting on it; queued selections are dropped with it.
  useEffect(
    () => () => {
      selectionQueueRef.current.length = 0;
      abortRef.current?.abort();
    },
    [],
  );

  const drainNextSelection = useCallback(() => {
    const selection = selectionQueueRef.current.shift();
    syncQueuedFileCount();
    if (!selection) {
      drainingRef.current = false;
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    activeContainerIdRef.current = selection.containerId;
    setRun(initialSelectionRun(selection));
    void runUploadSelection({
      controller,
      importDroppedFiles,
      selection,
      setItems,
      setRun,
    }).finally(() => {
      abortRef.current = null;
      activeContainerIdRef.current = null;
      drainNextSelection();
    });
  }, [importDroppedFiles, syncQueuedFileCount]);

  const startImport = useCallback(
    (containerId: string, files: ReadonlyArray<File>) => {
      if (files.length === 0) {
        return;
      }
      const selectionFiles = Array.from(files);
      const itemIds = selectionFiles.map(
        () => `upload-${++itemSeqRef.current}`,
      );
      setItems((current) =>
        trimRetainedUploadItems([
          ...current,
          ...createUploadItems(containerId, selectionFiles, itemIds),
        ]),
      );
      selectionQueueRef.current.push({
        containerId,
        files: selectionFiles,
        itemIds,
      });
      syncQueuedFileCount();
      if (!drainingRef.current) {
        drainingRef.current = true;
        drainNextSelection();
      }
    },
    [drainNextSelection, syncQueuedFileCount],
  );

  const { cancel, cancelForContainer } = useUploadCancellation({
    abortRef,
    activeContainerIdRef,
    selectionQueueRef,
    setItems,
    syncQueuedFileCount,
  });

  return {
    cancel,
    cancelForContainer,
    isImporting: run?.status === "running",
    items,
    queuedFileCount,
    queuedFileCounts,
    run,
    startImport,
  };
}

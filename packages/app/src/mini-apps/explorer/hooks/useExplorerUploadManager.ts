import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type {
  ExplorerDroppedFileImportProgress,
  ExplorerDroppedFileImportResult,
  ExplorerDroppedFileImportRunOptions,
  ImportExplorerDroppedFiles,
} from "../../../stores/explorer/useExplorerDroppedFileImport";
import {
  EXPLORER_LABELS,
  getExplorerFileImportCancelledStatus,
  getExplorerFileImportCompletedStatus,
  getExplorerFileImportingStatus,
  getExplorerFileImportPartialStatus,
  getExplorerUploadQueuedSuffix,
} from "../labels";

// A selection (one picker/drop/menu invocation) moves through exactly one of
// these terminal states after "running": done (every file imported), cancelled
// (the user stopped it — the already-imported prefix stays), or failed (the
// run was refused outright, or some files could not be imported).
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

// Per-file lifecycle. "imported" means ingested locally and awaiting sync —
// the Uploads panel derives uploading/synced from the document's sync lane.
export type ExplorerUploadItemStatus =
  | "queued"
  | "importing"
  | "imported"
  | "failed"
  | "cancelled";

export interface ExplorerUploadItem {
  containerId: string;
  error: string | null;
  fileName: string;
  fileSize: number;
  id: string;
  localId: string | null;
  status: ExplorerUploadItemStatus;
}

export interface ExplorerUploadManager {
  cancel: () => void;
  isImporting: boolean;
  items: ReadonlyArray<ExplorerUploadItem>;
  // Files in selections that have not started importing yet.
  queuedFileCount: number;
  // The ACTIVE selection's run (or the last terminal one when idle).
  run: ExplorerFileImportRunState | null;
  startImport: (containerId: string, files: ReadonlyArray<File>) => void;
}

// Oldest settled items are trimmed past this so a long session cannot grow the
// list without bound; outstanding (queued/importing) items are never trimmed.
const MAX_RETAINED_UPLOAD_ITEMS = 2000;

interface UploadSelection {
  containerId: string;
  files: File[];
  itemIds: string[];
}

type UploadItemsSetter = Dispatch<
  SetStateAction<ReadonlyArray<ExplorerUploadItem>>
>;
type UploadRunSetter = Dispatch<
  SetStateAction<ExplorerFileImportRunState | null>
>;

// The single status line for the active/last run, plus how much is still
// queued behind it. null hides the line (no run yet).
export function getExplorerUploadStatusText(
  run: ExplorerFileImportRunState | null,
  queuedFileCount: number,
): string | null {
  if (!run || run.progress.totalCount === 0) {
    return null;
  }
  const suffix =
    queuedFileCount > 0 ? getExplorerUploadQueuedSuffix(queuedFileCount) : "";
  switch (run.status) {
    case "running":
      return getExplorerFileImportingStatus(run.progress) + suffix;
    case "done":
      return (
        getExplorerFileImportCompletedStatus(run.progress.importedCount) +
        suffix
      );
    case "cancelled":
      return getExplorerFileImportCancelledStatus(run.progress) + suffix;
    case "failed":
      return (
        (run.error ?? getExplorerFileImportPartialStatus(run.progress)) + suffix
      );
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function uploadFailureMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : EXPLORER_LABELS.fileImportGenericFailure;
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

// Resolve the terminal state once the import promise settles. The settled
// result's own counts win over the last onProgress tick so the line is exact.
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

function initialSelectionRun(
  selection: UploadSelection,
): ExplorerFileImportRunState {
  return {
    containerId: selection.containerId,
    error: null,
    progress: {
      completedCount: 0,
      failedCount: 0,
      importedCount: 0,
      totalCount: selection.files.length,
    },
    status: "running",
  };
}

function isOutstandingUploadItem(item: ExplorerUploadItem): boolean {
  return item.status === "queued" || item.status === "importing";
}

function countQueuedFiles(queue: ReadonlyArray<UploadSelection>): number {
  return queue.reduce((total, selection) => total + selection.files.length, 0);
}

function trimRetainedUploadItems(
  items: ReadonlyArray<ExplorerUploadItem>,
): ReadonlyArray<ExplorerUploadItem> {
  const excess = items.length - MAX_RETAINED_UPLOAD_ITEMS;
  if (excess <= 0) {
    return items;
  }
  const trimmed: ExplorerUploadItem[] = [];
  let toDrop = excess;
  for (const item of items) {
    if (toDrop > 0 && !isOutstandingUploadItem(item)) {
      toDrop -= 1;
      continue;
    }
    trimmed.push(item);
  }
  return trimmed;
}

function createUploadItems(
  containerId: string,
  files: ReadonlyArray<File>,
  itemIds: ReadonlyArray<string>,
): ExplorerUploadItem[] {
  const items: ExplorerUploadItem[] = [];
  files.forEach((file, index) => {
    const id = itemIds[index];
    if (id === undefined) {
      return;
    }
    items.push({
      containerId,
      error: null,
      fileName: file.name,
      fileSize: file.size,
      id,
      localId: null,
      status: "queued",
    });
  });
  return items;
}

// Apply a terminal patch to every listed item the run never settled (still
// queued/importing); already-settled items keep their state.
function markOutstandingUploadItems(
  setItems: UploadItemsSetter,
  itemIds: Iterable<string>,
  patch: { error: string | null; status: ExplorerUploadItemStatus },
): void {
  const ids = new Set(itemIds);
  setItems((current) =>
    current.map((item) =>
      ids.has(item.id) && isOutstandingUploadItem(item)
        ? { ...item, ...patch }
        : item,
    ),
  );
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
  const [queuedFileCount, setQueuedFileCount] = useState(0);
  const selectionQueueRef = useRef<UploadSelection[]>([]);
  const drainingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
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

  const syncQueuedFileCount = useCallback(() => {
    setQueuedFileCount(countQueuedFiles(selectionQueueRef.current));
  }, []);

  const drainNextSelection = useCallback(() => {
    const selection = selectionQueueRef.current.shift();
    syncQueuedFileCount();
    if (!selection) {
      drainingRef.current = false;
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setRun(initialSelectionRun(selection));
    void runUploadSelection({
      controller,
      importDroppedFiles,
      selection,
      setItems,
      setRun,
    }).finally(() => {
      abortRef.current = null;
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

  const cancel = useCallback(() => {
    // Cancel everything outstanding: every not-yet-started selection
    // immediately, then the active one at its next batch boundary.
    const dropped = selectionQueueRef.current.splice(0);
    if (dropped.length > 0) {
      markOutstandingUploadItems(
        setItems,
        dropped.flatMap((selection) => selection.itemIds),
        { error: null, status: "cancelled" },
      );
    }
    syncQueuedFileCount();
    abortRef.current?.abort();
  }, [syncQueuedFileCount]);

  return {
    cancel,
    isImporting: run?.status === "running",
    items,
    queuedFileCount,
    run,
    startImport,
  };
}

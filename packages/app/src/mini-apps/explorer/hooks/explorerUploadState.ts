import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useState,
} from "react";
import type { ExplorerDroppedFileImportProgress } from "../../../stores/explorer/useExplorerDroppedFileImport";
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

// Oldest settled items are trimmed past this so a long session cannot grow the
// list without bound; outstanding (queued/importing) items are never trimmed.
const MAX_RETAINED_UPLOAD_ITEMS = 2000;

export interface UploadSelection {
  containerId: string;
  files: File[];
  itemIds: string[];
}

export type UploadItemsSetter = Dispatch<
  SetStateAction<ReadonlyArray<ExplorerUploadItem>>
>;
export type UploadRunSetter = Dispatch<
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

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export function uploadFailureMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : EXPLORER_LABELS.fileImportGenericFailure;
}

// A fresh progress object each tick, applied only while still running so a late
// callback can't overwrite an already-terminal state.
export function importRunWithProgress(
  current: ExplorerFileImportRunState | null,
  progress: ExplorerDroppedFileImportProgress,
): ExplorerFileImportRunState | null {
  return current && current.status === "running"
    ? { ...current, progress }
    : current;
}

// Resolve the terminal state once the import promise settles. The settled
// result's own counts win over the last onProgress tick so the line is exact.
export function settledImportRun(
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

export function initialSelectionRun(
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

function countQueuedFilesByContainer(
  queue: ReadonlyArray<UploadSelection>,
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const selection of queue) {
    counts.set(
      selection.containerId,
      (counts.get(selection.containerId) ?? 0) + selection.files.length,
    );
  }
  return counts;
}

// The published queued-file tallies (global and per-container), re-derived
// from the selection queue at every mutation point.
export function useQueuedFileCounts(queueRef: { current: UploadSelection[] }) {
  const [queuedFileCount, setQueuedFileCount] = useState(0);
  const [queuedFileCounts, setQueuedFileCounts] = useState<
    ReadonlyMap<string, number>
  >(new Map());
  const syncQueuedFileCount = useCallback(() => {
    setQueuedFileCount(countQueuedFiles(queueRef.current));
    setQueuedFileCounts(countQueuedFilesByContainer(queueRef.current));
  }, [queueRef]);
  return { queuedFileCount, queuedFileCounts, syncQueuedFileCount };
}

export function trimRetainedUploadItems(
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

export function createUploadItems(
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

// Remove the queued selections matching the predicate and mark their items
// cancelled; selections already running are not this function's concern.
export function dropQueuedSelections(
  queueRef: { current: UploadSelection[] },
  setItems: UploadItemsSetter,
  predicate: (selection: UploadSelection) => boolean,
): void {
  const dropped = queueRef.current.filter(predicate);
  if (dropped.length === 0) {
    return;
  }
  queueRef.current = queueRef.current.filter(
    (selection) => !predicate(selection),
  );
  markOutstandingUploadItems(
    setItems,
    dropped.flatMap((selection) => selection.itemIds),
    { error: null, status: "cancelled" },
  );
}

// Apply a terminal patch to every listed item the run never settled (still
// queued/importing); already-settled items keep their state.
export function markOutstandingUploadItems(
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

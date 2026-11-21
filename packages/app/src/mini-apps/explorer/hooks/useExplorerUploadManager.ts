import type {
  ContainerDocumentQueries,
  DomainScope,
} from "@tearleads/client-sdk";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useTearleadsExternalStoreSnapshot } from "../../../providers/sdk/useTearleadsSubscription";
import {
  type ExplorerUploadHistory,
  getOrCreateExplorerUploadHistory,
} from "../../../stores/explorer/explorerUploadHistory";
import type { ExplorerUploadItem } from "../../../stores/explorer/explorerUploadItemMachine";
import type {
  ExplorerDroppedFileImportResult,
  ExplorerDroppedFileImportRunOptions,
  ImportExplorerDroppedFiles,
} from "../../../stores/explorer/useExplorerDroppedFileImport";
import {
  createUploadItems,
  dropQueuedSelections,
  type ExplorerFileImportRunState,
  importRunWithProgress,
  initialSelectionRun,
  isAbortError,
  settledImportRun,
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
  history: ExplorerUploadHistory;
  pendingSyncKicks: Array<() => void>;
  selection: UploadSelection;
  setRun: UploadRunSetter;
  signal: AbortSignal;
}): ExplorerDroppedFileImportRunOptions {
  const fileItemIds = (fileIndex: number): string[] => {
    const itemId = input.selection.itemIds[fileIndex];
    return itemId === undefined ? [] : [itemId];
  };

  return {
    deferRequestSync: true,
    onFileFailed: (fileIndex, error) => {
      input.history.dispatch(fileItemIds(fileIndex), {
        error: uploadFailureMessage(error),
        type: "file-failed",
      });
    },
    onFileImported: ({ fileIndex, localId, requestSync, storageKeys }) => {
      input.pendingSyncKicks.push(requestSync);
      input.history.dispatch(fileItemIds(fileIndex), {
        localId,
        storageKeys,
        type: "imported",
      });
    },
    onFileStart: (fileIndex) => {
      input.history.dispatch(fileItemIds(fileIndex), {
        type: "import-started",
      });
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
  history: ExplorerUploadHistory;
  importDroppedFiles: ImportExplorerDroppedFiles;
  selection: UploadSelection;
  setRun: UploadRunSetter;
}): Promise<void> {
  const { history, selection, setRun } = input;
  const pendingSyncKicks: Array<() => void> = [];
  try {
    const result: ExplorerDroppedFileImportResult =
      await input.importDroppedFiles(
        selection.containerId,
        selection.files,
        createSelectionImportOptions({
          history,
          pendingSyncKicks,
          selection,
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
      history.dispatch(selection.itemIds, { type: "cancelled" });
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
    history.dispatch(
      selection.itemIds,
      aborted
        ? { type: "cancelled" }
        : { error: message, type: "selection-failed" },
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
  history: ExplorerUploadHistory;
  selectionQueueRef: { current: UploadSelection[] };
  syncQueuedFileCount: () => void;
}) {
  const {
    abortRef,
    activeContainerIdRef,
    history,
    selectionQueueRef,
    syncQueuedFileCount,
  } = input;

  const cancel = useCallback(() => {
    dropQueuedSelections(selectionQueueRef, history, () => true);
    syncQueuedFileCount();
    abortRef.current?.abort();
  }, [abortRef, history, selectionQueueRef, syncQueuedFileCount]);

  const cancelForContainer = useCallback(
    (containerId: string) => {
      dropQueuedSelections(
        selectionQueueRef,
        history,
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
      history,
      selectionQueueRef,
      syncQueuedFileCount,
    ],
  );

  return { cancel, cancelForContainer };
}

// A selection drains from the previous run's settlement, long after the render
// that queued it. Read the importer at drain time, not from that render's
// closure: its upload guard checks the container against the Explorer's nodes,
// so a stale importer refuses a folder created since the first selection
// started (and still accepts one that has since become read-only).
function useLatestImporter(importDroppedFiles: ImportExplorerDroppedFiles): {
  readonly current: ImportExplorerDroppedFiles;
} {
  const ref = useRef(importDroppedFiles);
  useLayoutEffect(() => {
    ref.current = importDroppedFiles;
  }, [importDroppedFiles]);
  return ref;
}

// Owns the explorer upload queue: every upload entry point (toolbar Upload,
// drag-and-drop, the folder context menu) enqueues its selection here, and the
// manager drains one selection at a time through the importer with per-file
// item tracking. Sync kickoff is DEFERRED until a selection settles, so ingest
// writes and sync-lane passes stop contending for the single serialized SQLite
// queue. Cancellation aborts the active selection at its next batch boundary
// and drops every not-yet-started selection. Items live in the scope's upload
// history, so finished uploads outlast this manager as Downloads and Sync
// Lanes history do.
export function useExplorerUploadManager(params: {
  documentQueries: ContainerDocumentQueries;
  domainScope: DomainScope;
  importDroppedFiles: ImportExplorerDroppedFiles;
}): ExplorerUploadManager {
  const { documentQueries, domainScope, importDroppedFiles } = params;
  const history = getOrCreateExplorerUploadHistory(domainScope);
  const items = useTearleadsExternalStoreSnapshot(history);
  const [run, setRun] = useState<ExplorerFileImportRunState | null>(null);
  const selectionQueueRef = useRef<UploadSelection[]>([]);
  const { queuedFileCount, queuedFileCounts, syncQueuedFileCount } =
    useQueuedFileCounts(selectionQueueRef);
  const drainingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const activeContainerIdRef = useRef<string | null>(null);
  const importDroppedFilesRef = useLatestImporter(importDroppedFiles);
  useEffect(() => {
    history.setDocumentQueries(documentQueries);
  }, [documentQueries, history]);
  // Abort any in-flight import on unmount so it can't keep creating documents
  // with no UI reporting on it; queued selections are cancelled with it, and
  // the aborted run cancels its own unimported files when it settles.
  useEffect(
    () => () => {
      dropQueuedSelections(selectionQueueRef, history, () => true);
      abortRef.current?.abort();
    },
    [history],
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
      history,
      importDroppedFiles: importDroppedFilesRef.current,
      selection,
      setRun,
    }).finally(() => {
      abortRef.current = null;
      activeContainerIdRef.current = null;
      drainNextSelection();
    });
  }, [history, syncQueuedFileCount]);

  const startImport = useCallback(
    (containerId: string, files: ReadonlyArray<File>) => {
      if (files.length === 0) {
        return;
      }
      const selectionFiles = Array.from(files);
      const itemIds = selectionFiles.map(() => history.nextItemId());
      history.add(createUploadItems(containerId, selectionFiles, itemIds));
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
    [drainNextSelection, history, syncQueuedFileCount],
  );

  const { cancel, cancelForContainer } = useUploadCancellation({
    abortRef,
    activeContainerIdRef,
    history,
    selectionQueueRef,
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

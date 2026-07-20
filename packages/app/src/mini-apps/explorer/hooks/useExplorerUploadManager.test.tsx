import { afterEach, expect, test } from "bun:test";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type {
  ExplorerDroppedFileImportResult,
  ExplorerDroppedFileImportRunOptions,
  ImportExplorerDroppedFiles,
} from "../../../stores/explorer/useExplorerDroppedFileImport";
import { getExplorerUploadStatusText } from "./explorerUploadState";
import { useExplorerUploadManager } from "./useExplorerUploadManager";

afterEach(() => cleanup());

const TWO_FILES = [
  new File(["Alpha"], "a.txt", { type: "text/plain" }),
  new File(["Beta"], "b.txt", { type: "text/plain" }),
];

function importResult(
  overrides: Partial<ExplorerDroppedFileImportResult> = {},
): ExplorerDroppedFileImportResult {
  return {
    aborted: false,
    completedCount: 2,
    failedCount: 0,
    importedCount: 2,
    importedDocuments: [],
    totalCount: 2,
    ...overrides,
  };
}

function renderManager(importDroppedFiles: ImportExplorerDroppedFiles) {
  return renderHook(() => useExplorerUploadManager({ importDroppedFiles }));
}

test("a clean import tracks per-file items and settles as done", async () => {
  const requestedSyncs: string[] = [];
  let capturedOptions: ExplorerDroppedFileImportRunOptions | undefined;
  const importDroppedFiles: ImportExplorerDroppedFiles = async (
    _containerId,
    files,
    options,
  ) => {
    capturedOptions = options;
    files.forEach((file, index) => {
      options?.onFileStart?.(index);
      options?.onFileImported?.({
        fileIndex: index,
        localId: `local-${index}`,
        requestSync: () => {
          requestedSyncs.push(file.name);
        },
      });
      options?.onProgress?.({
        completedCount: index + 1,
        failedCount: 0,
        importedCount: index + 1,
        totalCount: files.length,
      });
    });
    return importResult();
  };
  const { result } = renderManager(importDroppedFiles);

  act(() => result.current.startImport("folder-1", TWO_FILES));

  await waitFor(() => expect(result.current.run?.status).toBe("done"));
  // Sync kickoff is deferred to the importer options and fired on settle.
  expect(capturedOptions?.deferRequestSync).toBe(true);
  expect(requestedSyncs).toEqual(["a.txt", "b.txt"]);
  expect(
    result.current.items.map((item) => ({
      localId: item.localId,
      name: item.fileName,
      status: item.status,
    })),
  ).toEqual([
    { localId: "local-0", name: "a.txt", status: "imported" },
    { localId: "local-1", name: "b.txt", status: "imported" },
  ]);
  expect(getExplorerUploadStatusText(result.current.run, 0)).toBe(
    "Imported 2 files.",
  );
});

test("a second selection queues and drains after the first settles", async () => {
  const startedContainerIds: string[] = [];
  const resolvers: Array<(result: ExplorerDroppedFileImportResult) => void> =
    [];
  const importDroppedFiles: ImportExplorerDroppedFiles = (
    containerId,
    _files,
    _options,
  ) => {
    startedContainerIds.push(containerId);
    return new Promise((resolve) => {
      resolvers.push(resolve);
    });
  };
  const { result } = renderManager(importDroppedFiles);

  act(() => result.current.startImport("folder-1", TWO_FILES));
  act(() =>
    result.current.startImport("folder-2", [
      new File(["Gamma"], "c.txt", { type: "text/plain" }),
    ]),
  );

  // The second selection waits its turn rather than being dropped.
  expect(startedContainerIds).toEqual(["folder-1"]);
  expect(result.current.queuedFileCount).toBe(1);
  expect(getExplorerUploadStatusText(result.current.run, 1)).toBe(
    "Importing 0/2 files... 1 more file queued.",
  );

  await act(async () => {
    resolvers[0]?.(importResult());
  });

  await waitFor(() => expect(startedContainerIds.length).toBe(2));
  expect(startedContainerIds[1]).toBe("folder-2");
  expect(result.current.queuedFileCount).toBe(0);
  expect(result.current.run?.containerId).toBe("folder-2");

  await act(async () => {
    resolvers[1]?.(
      importResult({ completedCount: 1, importedCount: 1, totalCount: 1 }),
    );
  });
  await waitFor(() => expect(result.current.run?.status).toBe("done"));
});

test("cancel drops queued selections and aborts the active one", async () => {
  let capturedSignal: AbortSignal | undefined;
  let resolveImport: (result: ExplorerDroppedFileImportResult) => void = () =>
    undefined;
  const importDroppedFiles: ImportExplorerDroppedFiles = (
    _containerId,
    _files,
    options,
  ) => {
    capturedSignal = options?.signal;
    options?.onFileStart?.(0);
    options?.onFileImported?.({
      fileIndex: 0,
      localId: "local-0",
      requestSync: () => undefined,
    });
    return new Promise((resolve) => {
      resolveImport = resolve;
    });
  };
  const { result } = renderManager(importDroppedFiles);

  act(() => result.current.startImport("folder-1", TWO_FILES));
  act(() =>
    result.current.startImport("folder-2", [
      new File(["Gamma"], "c.txt", { type: "text/plain" }),
    ]),
  );
  expect(result.current.queuedFileCount).toBe(1);

  act(() => result.current.cancel());

  // Queued selections die immediately; the active one aborts at its boundary.
  expect(capturedSignal?.aborted).toBe(true);
  expect(result.current.queuedFileCount).toBe(0);
  expect(result.current.items.map((item) => item.status)).toEqual([
    "imported",
    "queued",
    "cancelled",
  ]);

  await act(async () => {
    resolveImport(
      importResult({ aborted: true, completedCount: 1, importedCount: 1 }),
    );
  });

  await waitFor(() => expect(result.current.run?.status).toBe("cancelled"));
  expect(getExplorerUploadStatusText(result.current.run, 0)).toBe(
    "Upload cancelled. Imported 1 of 2 files.",
  );
  // The active selection's unfinished file settles as cancelled too; the
  // imported prefix keeps its state.
  expect(result.current.items.map((item) => item.status)).toEqual([
    "imported",
    "cancelled",
    "cancelled",
  ]);
});

test("per-container tallies and cancelForContainer scope to one folder", async () => {
  const startedContainerIds: string[] = [];
  let capturedSignal: AbortSignal | undefined;
  let resolveImport: (result: ExplorerDroppedFileImportResult) => void = () =>
    undefined;
  const importDroppedFiles: ImportExplorerDroppedFiles = (
    containerId,
    _files,
    options,
  ) => {
    startedContainerIds.push(containerId);
    capturedSignal = options?.signal;
    return new Promise((resolve) => {
      resolveImport = resolve;
    });
  };
  const { result } = renderManager(importDroppedFiles);

  act(() => result.current.startImport("folder-1", TWO_FILES));
  act(() =>
    result.current.startImport("folder-2", [
      new File(["Gamma"], "c.txt", { type: "text/plain" }),
    ]),
  );
  act(() =>
    result.current.startImport("folder-3", [
      new File(["Delta"], "d.txt", { type: "text/plain" }),
      new File(["Epsilon"], "e.txt", { type: "text/plain" }),
    ]),
  );
  expect(result.current.queuedFileCount).toBe(3);
  expect(result.current.queuedFileCounts.get("folder-2")).toBe(1);
  expect(result.current.queuedFileCounts.get("folder-3")).toBe(2);

  // Cancelling folder-2 drops only its queued selection — the active folder-1
  // run and folder-3's queue are untouched.
  act(() => result.current.cancelForContainer("folder-2"));
  expect(capturedSignal?.aborted).toBe(false);
  expect(result.current.queuedFileCounts.get("folder-2")).toBeUndefined();
  expect(result.current.queuedFileCounts.get("folder-3")).toBe(2);
  expect(
    result.current.items
      .filter((item) => item.containerId === "folder-2")
      .map((item) => item.status),
  ).toEqual(["cancelled"]);

  // Cancelling the active container aborts its run; folder-3 stays queued and
  // drains next.
  act(() => result.current.cancelForContainer("folder-1"));
  expect(capturedSignal?.aborted).toBe(true);
  expect(result.current.queuedFileCounts.get("folder-3")).toBe(2);

  await act(async () => {
    resolveImport(
      importResult({ aborted: true, completedCount: 0, importedCount: 0 }),
    );
  });
  await waitFor(() =>
    expect(startedContainerIds).toEqual(["folder-1", "folder-3"]),
  );
});

test("a whole-run rejection fails the selection and its items", async () => {
  const importDroppedFiles: ImportExplorerDroppedFiles = async () => {
    throw new Error("This folder does not accept uploads.");
  };
  const { result } = renderManager(importDroppedFiles);

  act(() => result.current.startImport("folder-1", TWO_FILES));

  await waitFor(() => expect(result.current.run?.status).toBe("failed"));
  expect(getExplorerUploadStatusText(result.current.run, 0)).toBe(
    "This folder does not accept uploads.",
  );
  expect(result.current.items.map((item) => item.status)).toEqual([
    "failed",
    "failed",
  ]);
  expect(result.current.items[0]?.error).toBe(
    "This folder does not accept uploads.",
  );
});

test("a genuine failure racing a user cancel keeps its message", async () => {
  let rejectImport: (error: Error) => void = () => undefined;
  const importDroppedFiles: ImportExplorerDroppedFiles = () =>
    new Promise((_resolve, reject) => {
      rejectImport = reject;
    });
  const { result } = renderManager(importDroppedFiles);

  act(() => result.current.startImport("folder-1", TWO_FILES));
  act(() => result.current.cancel());

  // The rejection is NOT an AbortError, so despite the aborted signal the run
  // reports the real failure instead of masking it as a cancel.
  await act(async () => {
    rejectImport(new Error("database exploded"));
  });

  await waitFor(() => expect(result.current.run?.status).toBe("failed"));
  expect(result.current.run?.error).toBe("database exploded");
});

test("per-file failures settle as failed with the partial status", async () => {
  const importDroppedFiles: ImportExplorerDroppedFiles = async (
    _containerId,
    _files,
    options,
  ) => {
    options?.onFileStart?.(0);
    options?.onFileImported?.({
      fileIndex: 0,
      localId: "local-0",
      requestSync: () => undefined,
    });
    options?.onFileStart?.(1);
    options?.onFileFailed?.(1, new Error("read failed"));
    return importResult({ failedCount: 1, importedCount: 1 });
  };
  const { result } = renderManager(importDroppedFiles);

  act(() => result.current.startImport("folder-1", TWO_FILES));

  await waitFor(() => expect(result.current.run?.status).toBe("failed"));
  expect(getExplorerUploadStatusText(result.current.run, 0)).toBe(
    "Imported 1 of 2 files.",
  );
  expect(
    result.current.items.map((item) => ({
      error: item.error,
      status: item.status,
    })),
  ).toEqual([
    { error: null, status: "imported" },
    { error: "read failed", status: "failed" },
  ]);
});

test("an empty selection is ignored and unmount aborts the active import", () => {
  let capturedSignal: AbortSignal | undefined;
  const importDroppedFiles: ImportExplorerDroppedFiles = (
    _containerId,
    _files,
    options,
  ) => {
    capturedSignal = options?.signal;
    // Never settles: the run stays active until the hook unmounts.
    return new Promise(() => {});
  };
  const { result, unmount } = renderManager(importDroppedFiles);

  act(() => result.current.startImport("folder-empty", []));
  expect(result.current.run).toBeNull();
  expect(result.current.items).toEqual([]);

  act(() => result.current.startImport("folder-1", TWO_FILES));
  expect(capturedSignal?.aborted).toBe(false);

  unmount();

  expect(capturedSignal?.aborted).toBe(true);
});

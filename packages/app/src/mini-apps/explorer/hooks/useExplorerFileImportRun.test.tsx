import { afterEach, expect, test } from "bun:test";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type {
  ExplorerDroppedFileImportResult,
  ExplorerDroppedFileImportRunOptions,
  ImportExplorerDroppedFiles,
} from "../../../stores/explorer/useExplorerDroppedFileImport";
import {
  getExplorerFileImportRunStatusText,
  useExplorerFileImportRun,
} from "./useExplorerFileImportRun";

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

function renderImportRun(importDroppedFiles: ImportExplorerDroppedFiles) {
  return renderHook(() => useExplorerFileImportRun({ importDroppedFiles }));
}

test("a clean import reports progress and settles as done", async () => {
  const importDroppedFiles: ImportExplorerDroppedFiles = async (
    _containerId,
    _files,
    options,
  ) => {
    options?.onProgress?.({
      completedCount: 1,
      failedCount: 0,
      importedCount: 1,
      totalCount: 2,
    });
    return importResult();
  };
  const { result } = renderImportRun(importDroppedFiles);

  act(() => result.current.startImport("folder-1", TWO_FILES));
  expect(result.current.isImporting).toBe(true);
  expect(result.current.run?.containerId).toBe("folder-1");

  await waitFor(() => expect(result.current.run?.status).toBe("done"));
  expect(result.current.isImporting).toBe(false);
  expect(getExplorerFileImportRunStatusText(result.current.run)).toBe(
    "Imported 2 files.",
  );
});

test("cancel aborts the run's signal and settles as cancelled", async () => {
  let capturedOptions: ExplorerDroppedFileImportRunOptions | undefined;
  let resolveImport: (result: ExplorerDroppedFileImportResult) => void = () =>
    undefined;
  const importDroppedFiles: ImportExplorerDroppedFiles = (
    _containerId,
    _files,
    options,
  ) => {
    capturedOptions = options;
    return new Promise((resolve) => {
      resolveImport = resolve;
    });
  };
  const { result } = renderImportRun(importDroppedFiles);

  act(() => result.current.startImport("folder-1", TWO_FILES));
  act(() => result.current.cancel());
  expect(capturedOptions?.signal?.aborted).toBe(true);

  // The importer resolves with the partial prefix it managed to import.
  act(() =>
    resolveImport(
      importResult({ aborted: true, completedCount: 1, importedCount: 1 }),
    ),
  );

  await waitFor(() => expect(result.current.run?.status).toBe("cancelled"));
  expect(getExplorerFileImportRunStatusText(result.current.run)).toBe(
    "Upload cancelled. Imported 1 of 2 files.",
  );
});

test("a whole-run rejection settles as failed with its message", async () => {
  const importDroppedFiles: ImportExplorerDroppedFiles = async () => {
    throw new Error("This folder does not accept uploads.");
  };
  const { result } = renderImportRun(importDroppedFiles);

  act(() => result.current.startImport("folder-1", TWO_FILES));

  await waitFor(() => expect(result.current.run?.status).toBe("failed"));
  expect(getExplorerFileImportRunStatusText(result.current.run)).toBe(
    "This folder does not accept uploads.",
  );
});

test("per-file failures settle as failed with the partial status", async () => {
  const importDroppedFiles: ImportExplorerDroppedFiles = async () =>
    importResult({ failedCount: 1, importedCount: 1 });
  const { result } = renderImportRun(importDroppedFiles);

  act(() => result.current.startImport("folder-1", TWO_FILES));

  await waitFor(() => expect(result.current.run?.status).toBe("failed"));
  expect(getExplorerFileImportRunStatusText(result.current.run)).toBe(
    "Imported 1 of 2 files.",
  );
});

test("a second start while one runs is ignored, as is an empty selection", async () => {
  const startedContainerIds: string[] = [];
  let resolveImport: (result: ExplorerDroppedFileImportResult) => void = () =>
    undefined;
  const importDroppedFiles: ImportExplorerDroppedFiles = (containerId) => {
    startedContainerIds.push(containerId);
    return new Promise((resolve) => {
      resolveImport = resolve;
    });
  };
  const { result } = renderImportRun(importDroppedFiles);

  act(() => result.current.startImport("folder-empty", []));
  expect(result.current.run).toBeNull();

  act(() => result.current.startImport("folder-1", TWO_FILES));
  act(() => result.current.startImport("folder-2", TWO_FILES));
  expect(startedContainerIds).toEqual(["folder-1"]);
  expect(result.current.run?.containerId).toBe("folder-1");

  act(() => resolveImport(importResult()));
  await waitFor(() => expect(result.current.run?.status).toBe("done"));
});

test("unmounting mid-run aborts the in-flight import", () => {
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
  const { result, unmount } = renderImportRun(importDroppedFiles);

  act(() => result.current.startImport("folder-1", TWO_FILES));
  expect(capturedSignal?.aborted).toBe(false);

  unmount();

  expect(capturedSignal?.aborted).toBe(true);
});

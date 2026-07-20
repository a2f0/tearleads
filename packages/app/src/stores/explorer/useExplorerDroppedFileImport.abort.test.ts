import { expect, test } from "bun:test";
import type { StoredDocumentKind } from "@tearleads/client-sdk";
import { importExplorerDroppedFiles } from "./useExplorerDroppedFileImport";

const testImportLabels = {
  fileImportStoreNotReady: "Document store is not ready.",
  getFileImportFailureLog: (fileName: string) =>
    `Explorer: failed to import ${fileName}.`,
  getFileTooLargeError: (input: { fileName: string; maxByteLength: number }) =>
    `${input.fileName} is larger than ${(input.maxByteLength / 1024 / 1024).toFixed(1)} MB.`,
};

// A minimal always-ready note store: the abort test only needs to count how
// many stores the importer created before the signal stopped the run.
function createCountingStoreFactory(createdLocalIds: string[]) {
  return ({ localId }: { localId: string }) => {
    createdLocalIds.push(localId);
    let text = "";
    return {
      addRow: async () => "row-1",
      attachFiles: () => undefined,
      getSnapshot: () => ({
        documentId: null,
        documentKind: "note" as StoredDocumentKind,
        ready: true,
        title: text,
      }),
      requestSync: () => undefined,
      setStructuredFields: async () => undefined,
      setText: async (value: string) => {
        text = value;
      },
    };
  };
}

test("dropped file import stops scheduling batches once the signal aborts", async () => {
  const createdLocalIds: string[] = [];
  const controller = new AbortController();
  let nextLocalId = 0;
  // 12 files = one full batch of 8 plus a second batch that must never start.
  const files = Array.from(
    { length: 12 },
    (_, index) =>
      new File([`Body ${index}`], `file-${index}.txt`, { type: "text/plain" }),
  );

  const result = await importExplorerDroppedFiles({
    containerId: "folder-1",
    createDocumentStore: createCountingStoreFactory(createdLocalIds),
    createLocalId: () => `local-${++nextLocalId}`,
    files,
    labels: testImportLabels,
    loadDocumentSummary: async () => null,
    mergeDocumentSummary: () => undefined,
    onProgress: (progress) => {
      // Abort mid-run, after the first batch settles: cancellation is a batch
      // boundary check, so the in-flight batch completes and no more start.
      if (progress.completedCount === 8) {
        controller.abort();
      }
    },
    signal: controller.signal,
  });

  expect(result.aborted).toBe(true);
  expect(result.completedCount).toBe(8);
  expect(result.importedCount).toBe(8);
  expect(result.failedCount).toBe(0);
  expect(result.totalCount).toBe(12);
  expect(createdLocalIds).toHaveLength(8);
});

test("dropped file import resolves un-aborted when no signal is given", async () => {
  const createdLocalIds: string[] = [];
  let nextLocalId = 0;

  const result = await importExplorerDroppedFiles({
    containerId: "folder-1",
    createDocumentStore: createCountingStoreFactory(createdLocalIds),
    createLocalId: () => `local-${++nextLocalId}`,
    files: [new File(["Alpha"], "a.txt", { type: "text/plain" })],
    labels: testImportLabels,
    loadDocumentSummary: async () => null,
    mergeDocumentSummary: () => undefined,
  });

  expect(result.aborted).toBe(false);
  expect(result.importedCount).toBe(1);
  expect(createdLocalIds).toHaveLength(1);
});

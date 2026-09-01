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

interface CountingStore {
  localId: string;
  syncRequests: number;
}

// A minimal always-ready note store: these tests only count which stores the
// importer created and how often each one's sync was requested.
function createCountingStoreFactory(createdStores: CountingStore[]) {
  return ({ localId }: { localId: string }) => {
    const record: CountingStore = { localId, syncRequests: 0 };
    createdStores.push(record);
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
      requestSync: () => {
        record.syncRequests += 1;
      },
      setStructuredFields: async () => undefined,
      setText: async (value: string) => {
        text = value;
      },
    };
  };
}

test("dropped file import stops scheduling batches once the signal aborts", async () => {
  const createdStores: CountingStore[] = [];
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
    createDocumentStore: createCountingStoreFactory(createdStores),
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
  expect(createdStores).toHaveLength(8);
});

test("dropped file import resolves un-aborted when no signal is given", async () => {
  const createdStores: CountingStore[] = [];
  let nextLocalId = 0;

  const result = await importExplorerDroppedFiles({
    containerId: "folder-1",
    createDocumentStore: createCountingStoreFactory(createdStores),
    createLocalId: () => `local-${++nextLocalId}`,
    files: [new File(["Alpha"], "a.txt", { type: "text/plain" })],
    labels: testImportLabels,
    loadDocumentSummary: async () => null,
    mergeDocumentSummary: () => undefined,
  });

  expect(result.aborted).toBe(false);
  expect(result.importedCount).toBe(1);
  // Without deferRequestSync every imported file kicks its own sync.
  expect(createdStores.map((store) => store.syncRequests)).toEqual([1]);
});

test("an abort landing during the final batch reports an un-aborted run", async () => {
  const createdStores: CountingStore[] = [];
  const controller = new AbortController();
  let nextLocalId = 0;
  // 8 files = exactly one batch: the abort fires after it settles, when no
  // further batch exists to cut — nothing was cancelled, so the run is done.
  const files = Array.from(
    { length: 8 },
    (_, index) =>
      new File([`Body ${index}`], `file-${index}.txt`, { type: "text/plain" }),
  );

  const result = await importExplorerDroppedFiles({
    containerId: "folder-1",
    createDocumentStore: createCountingStoreFactory(createdStores),
    createLocalId: () => `local-${++nextLocalId}`,
    files,
    labels: testImportLabels,
    loadDocumentSummary: async () => null,
    mergeDocumentSummary: () => undefined,
    onProgress: (progress) => {
      if (progress.completedCount === 8) {
        controller.abort();
      }
    },
    signal: controller.signal,
  });

  expect(result.aborted).toBe(false);
  expect(result.importedCount).toBe(8);
});

test("a failed summary load still hands over the deferred sync kick", async () => {
  const createdStores: CountingStore[] = [];
  const deferredKicks: Array<() => void> = [];
  const failedFileIndexes: number[] = [];
  let nextLocalId = 0;

  const result = await importExplorerDroppedFiles({
    containerId: "folder-1",
    createDocumentStore: createCountingStoreFactory(createdStores),
    createLocalId: () => `local-${++nextLocalId}`,
    deferRequestSync: true,
    files: [new File(["Alpha"], "a.txt", { type: "text/plain" })],
    labels: testImportLabels,
    loadDocumentSummary: async () => {
      throw new Error("summary query exploded");
    },
    mergeDocumentSummary: () => undefined,
    onFileFailed: (fileIndex) => {
      failedFileIndexes.push(fileIndex);
    },
    onFileImported: ({ requestSync }) => {
      deferredKicks.push(requestSync);
    },
  });

  // The document is durable even though the file counts as failed, so the
  // deferred kick must survive the summary-load rejection.
  expect(result.failedCount).toBe(1);
  expect(failedFileIndexes).toEqual([0]);
  expect(deferredKicks).toHaveLength(1);
  for (const kick of deferredKicks) {
    kick();
  }
  expect(createdStores.map((store) => store.syncRequests)).toEqual([1]);
});

test("deferRequestSync skips per-file sync and hands back working kicks", async () => {
  const createdStores: CountingStore[] = [];
  const deferredKicks: Array<() => void> = [];
  const importedFiles: Array<{ fileIndex: number; localId: string }> = [];
  const startedFileIndexes: number[] = [];
  let nextLocalId = 0;

  const result = await importExplorerDroppedFiles({
    containerId: "folder-1",
    createDocumentStore: createCountingStoreFactory(createdStores),
    createLocalId: () => `local-${++nextLocalId}`,
    deferRequestSync: true,
    files: [
      new File(["Alpha"], "a.txt", { type: "text/plain" }),
      new File(["Beta"], "b.txt", { type: "text/plain" }),
    ],
    labels: testImportLabels,
    loadDocumentSummary: async () => null,
    mergeDocumentSummary: () => undefined,
    onFileImported: ({ fileIndex, localId, requestSync }) => {
      deferredKicks.push(requestSync);
      importedFiles.push({ fileIndex, localId });
    },
    onFileStart: (fileIndex) => {
      startedFileIndexes.push(fileIndex);
    },
  });

  expect(result.importedCount).toBe(2);
  expect(startedFileIndexes).toEqual([0, 1]);
  expect(importedFiles).toEqual([
    { fileIndex: 0, localId: "local-1" },
    { fileIndex: 1, localId: "local-2" },
  ]);
  // No store synced during ingest; each deferred kick reaches its own store.
  expect(createdStores.map((store) => store.syncRequests)).toEqual([0, 0]);
  for (const kick of deferredKicks) {
    kick();
  }
  expect(createdStores.map((store) => store.syncRequests)).toEqual([1, 1]);
});

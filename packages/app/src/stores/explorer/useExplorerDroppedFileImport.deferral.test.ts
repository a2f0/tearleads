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

interface DeferralStore {
  attachCount: number;
  deferInitialUpdate: boolean;
  documentKind: StoredDocumentKind;
  fieldWrites: Array<{ deferRemoteSync: boolean | undefined }>;
  rowCount: number;
}

function createDeferralStoreFactory(createdStores: DeferralStore[]) {
  return (input: {
    deferInitialUpdate: boolean;
    initialDocumentKind: StoredDocumentKind;
  }) => {
    const created: DeferralStore = {
      attachCount: 0,
      deferInitialUpdate: input.deferInitialUpdate,
      documentKind: input.initialDocumentKind,
      fieldWrites: [],
      rowCount: 0,
    };
    createdStores.push(created);
    return {
      addRow: async () => {
        created.rowCount += 1;
        return `row-${created.rowCount}`;
      },
      attachFiles: () => {
        created.attachCount += 1;
      },
      getSnapshot: () => ({
        documentId: null,
        documentKind: created.documentKind,
        ready: true,
        title: "",
      }),
      requestSync: () => undefined,
      setStructuredFields: async (
        _kind: Exclude<StoredDocumentKind, "note">,
        _patch: Readonly<Record<string, string | undefined>>,
        options?: { deferRemoteSync?: boolean },
      ) => {
        created.fieldWrites.push({ deferRemoteSync: options?.deferRemoteSync });
      },
      setText: async () => undefined,
    };
  };
}

function importFiles(files: File[], createdStores: DeferralStore[]) {
  let nextLocalId = 0;
  return importExplorerDroppedFiles({
    containerId: "folder-1",
    createDocumentStore: createDeferralStoreFactory(createdStores),
    createLocalId: () => `local-${++nextLocalId}`,
    files,
    labels: testImportLabels,
    loadDocumentSummary: async () => null,
    mergeDocumentSummary: () => undefined,
  });
}

test("only an attached binary file defers its birth and metadata to the attach", async () => {
  const createdStores: DeferralStore[] = [];
  const result = await importFiles(
    [
      new File([new Uint8Array([1, 2, 3])], "report.pdf", {
        type: "application/pdf",
      }),
      new File(['{"a":1}'], "data.json", { type: "application/json" }),
      new File(["API_TOKEN=secret"], ".env", { type: "text/plain" }),
      new File(["Plain text"], "notes.txt", { type: "text/plain" }),
    ],
    createdStores,
  );

  expect(result.importedCount).toBe(4);
  // The PDF's single attach update carries the birth and its metadata.
  expect(createdStores.find((store) => store.documentKind === "pdf")).toEqual({
    attachCount: 1,
    deferInitialUpdate: true,
    documentKind: "pdf",
    fieldWrites: [{ deferRemoteSync: true }],
    rowCount: 0,
  });
  // Without an attach to carry them, every other kind enqueues at birth.
  for (const store of createdStores.filter(
    (candidate) => candidate.documentKind !== "pdf",
  )) {
    expect(store.deferInitialUpdate).toBe(false);
    expect(store.attachCount).toBe(0);
    for (const write of store.fieldWrites) {
      expect(write.deferRemoteSync).toBe(false);
    }
  }
});

test("a cancelled import never leaves a deferred birth without its attach", async () => {
  const createdStores: DeferralStore[] = [];
  const controller = new AbortController();
  let nextLocalId = 0;
  // One full batch of 8 plus a batch the abort cuts: cancellation lands only
  // at batch boundaries, so every document it created reached its attach.
  const files = Array.from(
    { length: 12 },
    (_, index) =>
      new File([new Uint8Array([index])], `scan-${index}.pdf`, {
        type: "application/pdf",
      }),
  );

  const result = await importExplorerDroppedFiles({
    containerId: "folder-1",
    createDocumentStore: createDeferralStoreFactory(createdStores),
    createLocalId: () => `local-${++nextLocalId}`,
    files,
    labels: testImportLabels,
    loadDocumentSummary: async () => null,
    mergeDocumentSummary: () => undefined,
    onFileStart: (fileIndex) => {
      if (fileIndex === 3) controller.abort();
    },
    signal: controller.signal,
  });

  expect(result.aborted).toBe(true);
  expect(createdStores).toHaveLength(8);
  expect(
    createdStores.every(
      (store) => store.deferInitialUpdate && store.attachCount === 1,
    ),
  ).toBe(true);
});

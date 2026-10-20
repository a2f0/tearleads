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
  attachFileCounts: number[];
  deferInitialUpdate: boolean;
  documentKind: StoredDocumentKind;
  // Writes after open; each file's fields and rows must open as its birth.
  fieldWrites: Array<{ deferRemoteSync: boolean | undefined }>;
  initialFieldCount: number;
  initialRowCount: number;
  rowCount: number;
}

type StoreFailure = "not-ready" | "set-text-rejects";

function createDeferralStoreFactory(
  createdStores: DeferralStore[],
  failure?: StoreFailure,
) {
  return (input: {
    deferInitialUpdate: boolean;
    initialDocumentKind: StoredDocumentKind;
    initialRows: ReadonlyArray<unknown>;
    initialStructuredFields: Readonly<Record<string, string>>;
  }) => {
    const created: DeferralStore = {
      attachCount: 0,
      attachFileCounts: [],
      deferInitialUpdate: input.deferInitialUpdate,
      documentKind: input.initialDocumentKind,
      fieldWrites: [],
      initialFieldCount: Object.keys(input.initialStructuredFields).length,
      initialRowCount: input.initialRows.length,
      rowCount: 0,
    };
    createdStores.push(created);
    return {
      addRow: async () => {
        created.rowCount += 1;
        return `row-${created.rowCount}`;
      },
      attachFiles: (files: ReadonlyArray<unknown>) => {
        created.attachCount += 1;
        created.attachFileCounts.push(files.length);
      },
      getSnapshot: () => ({
        documentId: null,
        documentKind: created.documentKind,
        ready: failure !== "not-ready",
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
      setText: async () => {
        if (failure === "set-text-rejects") {
          throw new Error("store initialization failed");
        }
      },
    };
  };
}

function importFiles(
  files: File[],
  createdStores: DeferralStore[],
  failure?: StoreFailure,
) {
  let nextLocalId = 0;
  return importExplorerDroppedFiles({
    containerId: "folder-1",
    createDocumentStore: createDeferralStoreFactory(createdStores, failure),
    createLocalId: () => `local-${++nextLocalId}`,
    files,
    labels: testImportLabels,
    loadDocumentSummary: async () => null,
    mergeDocumentSummary: () => undefined,
  });
}

test("each file opens with its content and only an attached binary file defers it", async () => {
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
  const summaries = Object.fromEntries(
    createdStores.map((store) => [
      store.documentKind,
      {
        attachFileCounts: store.attachFileCounts,
        deferInitialUpdate: store.deferInitialUpdate,
        followUpWrites: store.fieldWrites.length + store.rowCount,
        opensWithFields: store.initialFieldCount > 0,
        opensWithRows: store.initialRowCount,
      },
    ]),
  );
  expect(summaries).toEqual({
    // The PDF's single attach update carries the birth and its metadata.
    pdf: {
      attachFileCounts: [1],
      deferInitialUpdate: true,
      followUpWrites: 0,
      opensWithFields: true,
      opensWithRows: 0,
    },
    // Without an attach to carry it, every other kind's birth is its update.
    json_file: {
      attachFileCounts: [],
      deferInitialUpdate: false,
      followUpWrites: 0,
      opensWithFields: true,
      opensWithRows: 0,
    },
    env_file: {
      attachFileCounts: [],
      deferInitialUpdate: false,
      followUpWrites: 0,
      opensWithFields: true,
      opensWithRows: 1,
    },
    note: {
      attachFileCounts: [],
      deferInitialUpdate: false,
      followUpWrites: 0,
      opensWithFields: false,
      opensWithRows: 0,
    },
  });
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

for (const failure of ["not-ready", "set-text-rejects"] as const) {
  test(`a binary import that fails after opening (${failure}) releases its deferred birth`, async () => {
    const createdStores: DeferralStore[] = [];
    const result = await importFiles(
      [
        new File([new Uint8Array([1, 2, 3])], "report.pdf", {
          type: "application/pdf",
        }),
        new File(["Plain text"], "notes.txt", { type: "text/plain" }),
      ],
      createdStores,
      failure,
    );

    expect(result.failedCount).toBe(2);
    // The PDF's store got one empty attach, which lifts its sync hold and
    // queues the durable birth on its own. The text file deferred nothing.
    const attachesByKind = Object.fromEntries(
      createdStores.map((store) => [
        store.documentKind,
        store.attachFileCounts,
      ]),
    );
    expect(attachesByKind).toEqual({ note: [], pdf: [0] });
  });
}

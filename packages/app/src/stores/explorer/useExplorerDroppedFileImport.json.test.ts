import { expect, test } from "bun:test";
import type {
  DocumentAttachmentUpload,
  DocumentSummary,
  StoredDocumentKind,
} from "@tearleads/client-sdk";
import { importExplorerDroppedFiles } from "./useExplorerDroppedFileImport";

interface CreatedImportStore {
  attachments: DocumentAttachmentUpload[];
  containerId: string;
  initialDocumentKind: StoredDocumentKind;
  initialText: string;
  ready: boolean;
  localId: string;
  // Field or row writes after open; the content must open as the birth.
  followUpWrites: number;
  structuredFields: Record<string, string | undefined>;
  syncRequests: number;
}

function createFile(
  name: string,
  content: BlobPart,
  options: FilePropertyBag = {},
): File {
  return new File([content], name, {
    lastModified: Date.UTC(2026, 4, 29, 12, 0, 0),
    ...options,
  });
}

function createImportStoreFactory(createdStores: CreatedImportStore[]) {
  return ({
    containerId,
    initialDocumentKind,
    initialStructuredFields,
    initialText,
    localId,
  }: {
    containerId: string;
    initialDocumentKind: StoredDocumentKind;
    initialStructuredFields: Readonly<Record<string, string>>;
    initialText: string;
    localId: string;
  }) => {
    const createdStore: CreatedImportStore = {
      attachments: [],
      containerId,
      followUpWrites: 0,
      initialDocumentKind,
      initialText,
      ready: false,
      localId,
      structuredFields: { ...initialStructuredFields },
      syncRequests: 0,
    };
    createdStores.push(createdStore);

    return {
      addRow: async () => {
        createdStore.followUpWrites += 1;
        return "row";
      },
      attachFiles: (files: ReadonlyArray<DocumentAttachmentUpload>) => {
        createdStore.attachments.push(...files);
      },
      getSnapshot: () => {
        const { fileName } = createdStore.structuredFields;
        return {
          documentId: null,
          documentKind: createdStore.initialDocumentKind,
          ready: createdStore.ready,
          title: fileName ?? createdStore.initialText ?? "Untitled",
        };
      },
      requestSync: () => {
        createdStore.syncRequests += 1;
      },
      setStructuredFields: async () => {
        createdStore.followUpWrites += 1;
      },
      setText: async (value: string) => {
        createdStore.ready = true;
        createdStore.initialText = value;
      },
    };
  };
}

const testImportLabels = {
  fileImportStoreNotReady: "Document store is not ready.",
  getFileImportFailureLog: (fileName: string) =>
    `Explorer: failed to import ${fileName}.`,
  getFileTooLargeError: (input: { fileName: string; maxByteLength: number }) =>
    `${input.fileName} is larger than ${(input.maxByteLength / 1024 / 1024).toFixed(1)} MB.`,
};

test("dropped file import creates JSON documents with raw text and filename metadata", async () => {
  const createdStores: CreatedImportStore[] = [];
  let nextLocalId = 0;
  const jsonText = '{\n  "enabled": true\n}';

  const result = await importExplorerDroppedFiles({
    containerId: "folder-1",
    createDocumentStore: createImportStoreFactory(createdStores),
    createLocalId: () => `local-${++nextLocalId}`,
    files: [
      createFile("config.json", jsonText, {
        type: "application/json",
      }),
    ],
    labels: testImportLabels,
    loadDocumentSummary: async (): Promise<DocumentSummary | null> => null,
    mergeDocumentSummary: () => undefined,
  });

  expect(result.importedCount).toBe(1);
  expect(result.failedCount).toBe(0);
  expect(result.importedDocuments[0]).toMatchObject({
    documentKind: "json_file",
    title: "config.json",
  });
  expect(createdStores).toEqual([
    {
      attachments: [],
      containerId: "folder-1",
      initialDocumentKind: "json_file",
      initialText: jsonText,
      localId: "local-1",
      ready: true,
      followUpWrites: 0,
      structuredFields: {
        fileName: "config.json",
      },
      syncRequests: 1,
    },
  ]);
});

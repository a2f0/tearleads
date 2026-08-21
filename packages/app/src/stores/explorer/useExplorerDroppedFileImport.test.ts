import { expect, test } from "bun:test";
import {
  blobByteSourceInputLength,
  type DocumentAttachmentUpload,
  type DocumentSummary,
  type StoredDocumentKind,
} from "@symcrypt/client-sdk";
import { BINARY_FILE_IMPORT_MAX_BYTES } from "../../document-types/importers";
import { importExplorerDroppedFiles } from "./useExplorerDroppedFileImport";

const TEXT_ENCODER = new TextEncoder();

interface CreatedImportStore {
  attachments: DocumentAttachmentUpload[];
  containerId: string;
  initialDocumentKind: StoredDocumentKind;
  initialText: string;
  ready: boolean;
  localId: string;
  rows: Array<Record<string, string>>;
  structuredFieldKind: StoredDocumentKind | null;
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

function createFailingTextFile(name: string, error: Error): File {
  const file = createFile(name, "x", { type: "text/plain" });
  Object.defineProperty(file, "text", {
    value: async () => {
      throw error;
    },
  });

  return file;
}

function createOversizedFile(input: {
  name: string;
  size: number;
  type: string;
}): File {
  const file = createFile(input.name, "", { type: input.type });
  Object.defineProperty(file, "arrayBuffer", {
    value: async () => {
      throw new Error("Oversized files should not be read.");
    },
  });
  Object.defineProperty(file, "size", { value: input.size });
  Object.defineProperty(file, "text", {
    value: async () => {
      throw new Error("Oversized files should not be read.");
    },
  });

  return file;
}

function createSummary(
  localId: string,
  containerId: string,
  documentKind: StoredDocumentKind = "note",
): DocumentSummary {
  return {
    id: localId,
    containerId,
    documentId: null,
    documentKind,
    title: `Persisted ${localId}`,
    updatedAt: "2026-05-18T12:00:00.000Z",
  };
}

function createImportStoreFactory(createdStores: CreatedImportStore[]) {
  return ({
    containerId,
    initialDocumentKind,
    initialText,
    localId,
  }: {
    containerId: string;
    initialDocumentKind: StoredDocumentKind;
    initialText: string;
    localId: string;
  }) => {
    const createdStore: CreatedImportStore = {
      attachments: [],
      containerId,
      initialDocumentKind,
      initialText,
      ready: false,
      localId,
      rows: [],
      structuredFieldKind: null,
      structuredFields: {},
      syncRequests: 0,
    };
    createdStores.push(createdStore);

    return {
      addRow: async (fields: Readonly<Record<string, string>>) => {
        createdStore.rows.push({ ...fields });
        return `row-${createdStore.rows.length}`;
      },
      attachFiles: (files: ReadonlyArray<DocumentAttachmentUpload>) => {
        createdStore.attachments.push(...files);
      },
      ensureInitialized: async () => true,
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
      setStructuredFields: async (
        kind: Exclude<StoredDocumentKind, "note">,
        patch: Readonly<Record<string, string | undefined>>,
      ) => {
        createdStore.ready = true;
        createdStore.structuredFieldKind = kind;
        createdStore.structuredFields = { ...patch };
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

test("dropped file import initializes notes and merges persisted summaries", async () => {
  const createdStores: CreatedImportStore[] = [];
  const merged: DocumentSummary[] = [];
  const progress: Array<{
    completedCount: number;
    failedCount: number;
    importedCount: number;
    totalCount: number;
  }> = [];
  const localIds = ["local-a", "local-b"];

  const result = await importExplorerDroppedFiles({
    containerId: "folder-1",
    createDocumentStore: createImportStoreFactory(createdStores),
    createLocalId: () => {
      const nextLocalId = localIds.shift();
      if (!nextLocalId) {
        throw new Error("No local id available.");
      }

      return nextLocalId;
    },
    files: [
      createFile("a.txt", "Alpha", { type: "text/plain" }),
      createFile("contacts.csv", "Beta", { type: "text/csv" }),
    ],
    labels: testImportLabels,
    loadDocumentSummary: async (localId) => createSummary(localId, "folder-1"),
    mergeDocumentSummary: (summary) => {
      merged.push(summary);
    },
    onProgress: (nextProgress) => {
      progress.push(nextProgress);
    },
  });

  expect(result.importedCount).toBe(2);
  expect(result.failedCount).toBe(0);
  expect(result.aborted).toBe(false);
  expect(result.importedDocuments.map((document) => document.id)).toEqual([
    "local-a",
    "local-b",
  ]);
  expect(merged.map((document) => document.title)).toEqual([
    "Persisted local-a",
    "Persisted local-b",
  ]);
  expect(
    createdStores.map((store) => ({
      attachments: store.attachments.length,
      containerId: store.containerId,
      initialDocumentKind: store.initialDocumentKind,
      initialText: store.initialText,
      localId: store.localId,
      structuredFieldKind: store.structuredFieldKind,
      syncRequests: store.syncRequests,
    })),
  ).toEqual([
    {
      attachments: 0,
      containerId: "folder-1",
      initialDocumentKind: "note",
      initialText: "Alpha",
      localId: "local-a",
      structuredFieldKind: null,
      syncRequests: 1,
    },
    {
      attachments: 0,
      containerId: "folder-1",
      initialDocumentKind: "note",
      initialText: "Beta",
      localId: "local-b",
      structuredFieldKind: null,
      syncRequests: 1,
    },
  ]);
  expect(progress.at(0)).toEqual({
    completedCount: 0,
    failedCount: 0,
    importedCount: 0,
    totalCount: 2,
  });
  expect(progress.at(-1)).toEqual({
    completedCount: 2,
    failedCount: 0,
    importedCount: 2,
    totalCount: 2,
  });
});

test("dropped file import creates file document types with original attachments", async () => {
  const createdStores: CreatedImportStore[] = [];
  let nextLocalId = 0;

  const result = await importExplorerDroppedFiles({
    containerId: "folder-1",
    createDocumentStore: createImportStoreFactory(createdStores),
    createLocalId: () => `local-${++nextLocalId}`,
    files: [
      createFile("dl_front.jpeg", TEXT_ENCODER.encode("jpeg"), {
        type: "image/jpeg",
      }),
      createFile("Skiff_Whitepaper_2023.pdf", TEXT_ENCODER.encode("pdf"), {
        type: "application/pdf",
      }),
      createFile("sample.mp3", TEXT_ENCODER.encode("mp3"), {
        type: "audio/mpeg",
      }),
      createFile("archive.bin", TEXT_ENCODER.encode("bin"), {
        type: "application/octet-stream",
      }),
    ],
    labels: testImportLabels,
    loadDocumentSummary: async () => null,
    mergeDocumentSummary: () => undefined,
  });

  expect(result.importedCount).toBe(4);
  expect(result.failedCount).toBe(0);
  expect(
    result.importedDocuments.map((document) => document.documentKind),
  ).toEqual(["image", "pdf", "audio", "generic_file"]);
  const createdStoresByKind = [...createdStores].sort((left, right) =>
    left.initialDocumentKind.localeCompare(right.initialDocumentKind),
  );
  expect(
    createdStoresByKind.map((store) => {
      const { fileName } = store.structuredFields;
      return {
        attachmentName: store.attachments[0]?.name,
        attachmentType: store.attachments[0]?.mimeType,
        initialDocumentKind: store.initialDocumentKind,
        initialText: store.initialText,
        structuredFieldKind: store.structuredFieldKind,
        title: fileName,
      };
    }),
  ).toEqual([
    {
      attachmentName: "sample.mp3",
      attachmentType: "audio/mpeg",
      initialDocumentKind: "audio",
      initialText: "",
      structuredFieldKind: "audio",
      title: "sample.mp3",
    },
    {
      attachmentName: "archive.bin",
      // An unrecognized extension with a generic application/octet-stream
      // declared type infers to no MIME type (null) rather than echoing back
      // the placeholder octet-stream that inferMimeType deliberately rejects.
      attachmentType: null,
      initialDocumentKind: "generic_file",
      initialText: "",
      structuredFieldKind: "generic_file",
      title: "archive.bin",
    },
    {
      attachmentName: "dl_front.jpeg",
      attachmentType: "image/jpeg",
      initialDocumentKind: "image",
      initialText: "",
      structuredFieldKind: "image",
      title: "dl_front.jpeg",
    },
    {
      attachmentName: "Skiff_Whitepaper_2023.pdf",
      attachmentType: "application/pdf",
      initialDocumentKind: "pdf",
      initialText: "",
      structuredFieldKind: "pdf",
      title: "Skiff_Whitepaper_2023.pdf",
    },
  ]);
});

test("dropped file import creates env file documents without attachments", async () => {
  const createdStores: CreatedImportStore[] = [];
  let nextLocalId = 0;

  const result = await importExplorerDroppedFiles({
    containerId: "folder-1",
    createDocumentStore: createImportStoreFactory(createdStores),
    createLocalId: () => `local-${++nextLocalId}`,
    files: [
      createFile(".env", "API_TOKEN=secret\nexport DEBUG=true", {
        type: "text/plain",
      }),
    ],
    labels: testImportLabels,
    loadDocumentSummary: async () => null,
    mergeDocumentSummary: () => undefined,
  });

  expect(result.importedCount).toBe(1);
  expect(result.failedCount).toBe(0);
  expect(result.importedDocuments[0]).toMatchObject({
    documentKind: "env_file",
    title: ".env",
  });
  expect(createdStores).toHaveLength(1);
  expect(createdStores[0]).toMatchObject({
    attachments: [],
    initialDocumentKind: "env_file",
    initialText: "",
    rows: [
      { key: "API_TOKEN", value: "secret" },
      { key: "DEBUG", value: "true" },
    ],
    structuredFieldKind: "env_file",
    structuredFields: {
      fileName: ".env",
    },
  });
});

test("dropped file import keeps going when one file fails", async () => {
  const errors: string[] = [];
  const merged: DocumentSummary[] = [];
  const createdStores: CreatedImportStore[] = [];
  let nextLocalId = 0;

  const result = await importExplorerDroppedFiles({
    containerId: "folder-1",
    createDocumentStore: createImportStoreFactory(createdStores),
    createLocalId: () => `local-${++nextLocalId}`,
    files: [
      createFile("ok.txt", "Imported", { type: "text/plain" }),
      createFailingTextFile("bad.txt", new Error("read failed")),
    ],
    labels: testImportLabels,
    loadDocumentSummary: async (localId) => createSummary(localId, "folder-1"),
    logError: (message) => {
      errors.push(message);
    },
    mergeDocumentSummary: (summary) => {
      merged.push(summary);
    },
  });

  expect(result.importedCount).toBe(1);
  expect(result.failedCount).toBe(1);
  expect(merged.map((document) => document.id)).toEqual(["local-1"]);
  expect(createdStores).toHaveLength(1);
  expect(errors).toEqual(["Explorer: failed to import bad.txt."]);
});

test("dropped file import applies the text size limit before reading text", async () => {
  const errors: string[] = [];
  let localIdCount = 0;
  let storeCount = 0;

  const result = await importExplorerDroppedFiles({
    containerId: "folder-1",
    createDocumentStore: () => {
      storeCount += 1;
      throw new Error("Oversized files should not create stores.");
    },
    createLocalId: () => `local-${++localIdCount}`,
    files: [
      createOversizedFile({
        name: "large.txt",
        size: 6 * 1024 * 1024,
        type: "text/plain",
      }),
    ],
    labels: testImportLabels,
    loadDocumentSummary: async (localId) => createSummary(localId, "folder-1"),
    logError: (message, cause) => {
      errors.push(
        `${message} ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    },
    mergeDocumentSummary: () => undefined,
  });

  expect(result.importedCount).toBe(0);
  expect(result.failedCount).toBe(1);
  expect(localIdCount).toBe(0);
  expect(storeCount).toBe(0);
  expect(errors).toEqual([
    "Explorer: failed to import large.txt. large.txt is larger than 5.0 MB.",
  ]);
});

test("dropped file import accepts binary attachments through 1 GiB", async () => {
  const createdStores: CreatedImportStore[] = [];
  const errors: string[] = [];
  let nextLocalId = 0;

  const result = await importExplorerDroppedFiles({
    containerId: "folder-1",
    createDocumentStore: createImportStoreFactory(createdStores),
    createLocalId: () => `local-${++nextLocalId}`,
    files: [
      createOversizedFile({
        name: "one-gib.mp3",
        size: BINARY_FILE_IMPORT_MAX_BYTES,
        type: "audio/mpeg",
      }),
      createOversizedFile({
        name: "huge.mp3",
        size: BINARY_FILE_IMPORT_MAX_BYTES + 1,
        type: "audio/mpeg",
      }),
    ],
    labels: testImportLabels,
    loadDocumentSummary: async () => null,
    logError: (message, cause) => {
      errors.push(
        `${message} ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    },
    mergeDocumentSummary: () => undefined,
  });

  expect(result.importedCount).toBe(1);
  expect(result.failedCount).toBe(1);
  expect(createdStores[0]?.initialDocumentKind).toBe("audio");
  const boundaryAttachment = createdStores[0]?.attachments[0]?.bytes;
  expect(
    boundaryAttachment && blobByteSourceInputLength(boundaryAttachment),
  ).toBe(BINARY_FILE_IMPORT_MAX_BYTES);
  expect(errors).toEqual([
    "Explorer: failed to import huge.mp3. huge.mp3 is larger than 1024.0 MB.",
  ]);
});

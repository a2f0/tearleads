import { expect, test } from "bun:test";
import type { DocumentSummary } from "../../../data/documentSummary";
import { importExplorerDroppedFiles } from "./useExplorerDroppedFileImport";

interface FakeRuntime {
  containerId: string;
}

function createTextFile(name: string, text: string): File {
  return {
    name,
    size: text.length,
    text: async () => text,
  } as unknown as File;
}

function createFailingFile(name: string, error: Error): File {
  return {
    name,
    size: 1,
    text: async () => {
      throw error;
    },
  } as unknown as File;
}

function createOversizedFile(name: string): File {
  return {
    name,
    size: 6 * 1024 * 1024,
    text: async () => {
      throw new Error("Oversized files should not be read.");
    },
  } as unknown as File;
}

function createSummary(localId: string, containerId: string): DocumentSummary {
  return {
    id: localId,
    containerId,
    documentId: null,
    documentKind: "note",
    title: `Persisted ${localId}`,
    updatedAt: "2026-05-18T12:00:00.000Z",
  };
}

test("dropped file import initializes notes and merges persisted summaries", async () => {
  const createdStores: Array<{
    initialText: string;
    localId: string;
    runtime: FakeRuntime;
    syncRequests: number;
  }> = [];
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
    createDocumentRuntime: (containerId): FakeRuntime => ({ containerId }),
    createDocumentStore: ({ initialText, localId, runtime }) => {
      const createdStore = {
        initialText,
        localId,
        runtime,
        syncRequests: 0,
      };
      createdStores.push(createdStore);

      return {
        ensureInitialized: async () => true,
        getSnapshot: () => ({
          documentId: null,
          documentKind: "note" as const,
          title: initialText,
        }),
        requestSync: () => {
          createdStore.syncRequests += 1;
        },
      };
    },
    createLocalId: () => {
      const nextLocalId = localIds.shift();
      if (!nextLocalId) {
        throw new Error("No local id available.");
      }

      return nextLocalId;
    },
    files: [createTextFile("a.txt", "Alpha"), createTextFile("b.txt", "Beta")],
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
  expect(result.importedDocuments.map((document) => document.id)).toEqual([
    "local-a",
    "local-b",
  ]);
  expect(merged.map((document) => document.title)).toEqual([
    "Persisted local-a",
    "Persisted local-b",
  ]);
  expect(createdStores).toEqual([
    {
      initialText: "Alpha",
      localId: "local-a",
      runtime: { containerId: "folder-1" },
      syncRequests: 1,
    },
    {
      initialText: "Beta",
      localId: "local-b",
      runtime: { containerId: "folder-1" },
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

test("dropped file import keeps going when one file fails", async () => {
  const errors: string[] = [];
  const merged: DocumentSummary[] = [];
  let nextLocalId = 0;

  const result = await importExplorerDroppedFiles({
    containerId: "folder-1",
    createDocumentRuntime: (containerId): FakeRuntime => ({ containerId }),
    createDocumentStore: ({ initialText }) => ({
      ensureInitialized: async () => true,
      getSnapshot: () => ({
        documentId: null,
        documentKind: "note" as const,
        title: initialText,
      }),
      requestSync: () => undefined,
    }),
    createLocalId: () => `local-${++nextLocalId}`,
    files: [
      createTextFile("ok.txt", "Imported"),
      createFailingFile("bad.txt", new Error("read failed")),
    ],
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
  expect(errors).toEqual(["Explorer: failed to import bad.txt."]);
});

test("dropped file import rejects oversized files before reading text", async () => {
  const errors: string[] = [];
  let localIdCount = 0;
  let storeCount = 0;

  const result = await importExplorerDroppedFiles({
    containerId: "folder-1",
    createDocumentRuntime: (containerId): FakeRuntime => ({ containerId }),
    createDocumentStore: () => {
      storeCount += 1;
      throw new Error("Oversized files should not create stores.");
    },
    createLocalId: () => `local-${++localIdCount}`,
    files: [createOversizedFile("large.txt")],
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

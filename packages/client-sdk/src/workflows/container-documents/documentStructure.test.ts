import { expect, test } from "bun:test";
import type { DocumentSummary } from "../../data/documentSummary";
import {
  activateDocumentLinkState,
  canMutateDocumentLink,
  type DocumentStructuralMutationHost,
  type DocumentStructuralMutationRelinkInput,
  type DocumentStructuralMutationRuntime,
} from "./documentStructure";
import { createContainerDocumentsWorkflowSqlRuntime } from "./runtime";

function createRuntime(logs: string[] = []): DocumentStructuralMutationRuntime {
  return {
    ...createContainerDocumentsWorkflowSqlRuntime({ execSql: async () => [] }),
    apiClient: {} as DocumentStructuralMutationRuntime["apiClient"],
    dbStatus: "ready",
    encapsulationKeyPair: null,
    isAuthenticated: true,
    log: (message) => {
      logs.push(message);
    },
    online: true,
    resolveProjectionUserKey: async () => null,
  };
}

function createNote(overrides: Partial<DocumentSummary> = {}): DocumentSummary {
  return {
    id: "note-1",
    containerId: "container-1",
    documentId: "document-1",
    title: "Note 1",
    updatedAt: "2026-05-09T00:00:00.000Z",
    ...overrides,
  };
}

test("canMutateDocumentLink checks local mutation prerequisites", () => {
  expect(canMutateDocumentLink(createRuntime())).toBe(true);
  expect(
    canMutateDocumentLink({
      dbStatus: "loading",
      isAuthenticated: true,
      online: true,
    }),
  ).toBe(false);
  expect(
    canMutateDocumentLink({
      dbStatus: "ready",
      isAuthenticated: false,
      online: true,
    }),
  ).toBe(false);
  expect(
    canMutateDocumentLink({
      dbStatus: "ready",
      isAuthenticated: true,
      online: false,
    }),
  ).toBe(false);
});

test("activateDocumentLinkState relinks the local document without requesting remote sync", async () => {
  const logs: string[] = [];
  const mergedDocuments: DocumentSummary[] = [];
  const relinkInputs: DocumentStructuralMutationRelinkInput[] = [];
  const requestedSyncs: string[] = [];
  const updatedRuntimes: string[] = [];
  const host: DocumentStructuralMutationHost<string> = {
    createDocumentRuntime: (containerId) => `runtime:${containerId}`,
    mergeDocumentSummary: (document) => {
      mergedDocuments.push(document);
    },
    primeDocumentStore: () => ({
      ensureInitialized: async () => true,
      relink: async (input) => {
        relinkInputs.push(input);
        return {
          id: input.localId,
          containerId: input.containerId,
          documentId: input.documentId,
          title: "Relinked note",
          updatedAt: "2026-05-09T00:00:01.000Z",
        };
      },
      requestSync: () => {
        requestedSyncs.push("sync");
      },
      updateRuntime: (runtime) => {
        updatedRuntimes.push(runtime);
      },
    }),
  };

  const activated = await activateDocumentLinkState({
    host,
    note: createNote(),
    runtime: createRuntime(logs),
    targetContainerId: "container-2",
  });

  if (!activated) {
    throw new Error("Expected activation to relink the document.");
  }
  expect(activated).toEqual({
    id: "note-1",
    containerId: "container-2",
    documentId: "document-1",
    title: "Relinked note",
    updatedAt: "2026-05-09T00:00:01.000Z",
  });
  expect(relinkInputs).toEqual([
    {
      accessEpoch: 1,
      containerId: "container-2",
      documentId: "document-1",
      localId: "note-1",
      queueBaselineAfterRelink: undefined,
    },
  ]);
  expect(mergedDocuments).toEqual([activated]);
  expect(updatedRuntimes).toEqual(["runtime:container-2"]);
  expect(requestedSyncs).toEqual([]);
  expect(logs).toEqual([
    "Container documents: switched active note note-1 to container-2",
  ]);
});

test("activateDocumentLinkState skips documents that are not locally ready", async () => {
  const logs: string[] = [];
  const host: DocumentStructuralMutationHost<string> = {
    createDocumentRuntime: (containerId) => `runtime:${containerId}`,
    mergeDocumentSummary: () => {
      throw new Error("mergeDocumentSummary should not be called.");
    },
    primeDocumentStore: () => ({
      ensureInitialized: async () => false,
      relink: async () => {
        throw new Error("relink should not be called.");
      },
      requestSync: () => {
        throw new Error("requestSync should not be called.");
      },
      updateRuntime: () => {
        throw new Error("updateRuntime should not be called.");
      },
    }),
  };

  const activated = await activateDocumentLinkState({
    host,
    note: createNote(),
    runtime: createRuntime(logs),
    targetContainerId: "container-2",
  });

  expect(activated).toBeNull();
  expect(logs).toEqual([
    "Container documents: note note-1 is not ready to mutate locally",
  ]);
});

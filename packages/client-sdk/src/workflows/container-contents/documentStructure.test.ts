import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import type { DocumentSummary } from "../../data/documentSummary";
import { defaultDocumentProjectorRegistry } from "../../data/documents/documentKinds";
import { createDomainScope } from "../../data/domainScope";
import { sqlDocumentMoveIntentPersistence } from "../../data/persistence/container-contents/documentMoveIntentPersistence";
import { sqlDocumentContainerProjectionPersistence } from "../../data/persistence/containers/documentContainerProjectionPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import {
  activateDocumentLink,
  canMutateDocumentLink,
  canMutateLocalDocumentLink,
  type DocumentStructuralMutationHost,
  type DocumentStructuralMutationRelinkInput,
  type DocumentStructuralMutationRuntime,
  moveDocumentLink,
} from "./documentStructure";

function createRuntime(
  logs: string[] = [],
  execSql: ExecSql = async () => [],
): DocumentStructuralMutationRuntime {
  return {
    apiClient: {} as DocumentStructuralMutationRuntime["apiClient"],
    auth: {
      isAuthenticated: true,
      organizationId: null,
      userId: null,
    },
    crypto: {
      encapsulationKeyPair: null,
      signingFingerprint: null,
      signingKeyPair: null,
    },
    getEncapsulationKey: async () => null,
    infra: {
      blobStore: null as never,
      dbStatus: "ready",
      documentProjectors: defaultDocumentProjectorRegistry,
      execSql,
    },
    state: {
      containerId: null,
      domainScope: createDomainScope(),
      events: [],
      online: true,
    },
    util: {
      cacheReferencedPrincipalPolicies: async () => undefined,
      log: (message) => {
        logs.push(message);
      },
    },
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
      auth: { isAuthenticated: true },
      infra: { dbStatus: "loading" },
      state: { online: true },
    }),
  ).toBe(false);
  expect(
    canMutateDocumentLink({
      auth: { isAuthenticated: false },
      infra: { dbStatus: "ready" },
      state: { online: true },
    }),
  ).toBe(false);
  expect(
    canMutateDocumentLink({
      auth: { isAuthenticated: true },
      infra: { dbStatus: "ready" },
      state: { online: false },
    }),
  ).toBe(false);
});

test("canMutateLocalDocumentLink only requires local storage readiness", () => {
  expect(canMutateLocalDocumentLink({ infra: { dbStatus: "ready" } })).toBe(
    true,
  );
  expect(canMutateLocalDocumentLink({ infra: { dbStatus: "loading" } })).toBe(
    false,
  );
});

test("moveDocumentLink relinks local-only documents without remote mutation", async () => {
  const logs: string[] = [];
  const expandedNodes: string[] = [];
  const mergedDocuments: DocumentSummary[] = [];
  const relinkInputs: DocumentStructuralMutationRelinkInput[] = [];
  const requestedSyncs: string[] = [];
  const updatedRuntimes: string[] = [];
  const primeInputs: Parameters<
    DocumentStructuralMutationHost<string>["openDocumentStore"]
  >[0][] = [];
  const host: DocumentStructuralMutationHost<string> = {
    documentWorkflowRuntime: (containerId) => `runtime:${containerId}`,
    mergeDocumentSummary: (document) => {
      mergedDocuments.push(document);
    },
    openDocumentStore: (input) => {
      primeInputs.push(input);
      return {
        ensureInitialized: async () => true,
        relink: async (relinkInput) => {
          relinkInputs.push(relinkInput);
          return {
            id: relinkInput.localId,
            containerId: relinkInput.containerId,
            documentId: relinkInput.documentId,
            title: "Relinked local note",
            updatedAt: "2026-05-09T00:00:01.000Z",
          };
        },
        requestSync: () => {
          requestedSyncs.push("sync");
        },
        updateRuntime: (runtime) => {
          updatedRuntimes.push(runtime);
        },
      };
    },
  };

  const moved = await moveDocumentLink({
    expandNode: (nodeId) => {
      expandedNodes.push(nodeId);
    },
    host,
    note: createNote({ documentId: null }),
    runtime: createRuntime(logs),
    setLinkedContainerIdsForDocument: () => {
      throw new Error("Local moves should not update remote link projections.");
    },
    targetContainerId: "trash-container",
  });
  if (!moved.note) {
    throw new Error("Expected local move to return the relinked note.");
  }

  expect(moved).toEqual({
    linksChanged: true,
    note: {
      id: "note-1",
      containerId: "trash-container",
      documentId: null,
      title: "Relinked local note",
      updatedAt: "2026-05-09T00:00:01.000Z",
    },
  });
  expect(primeInputs).toEqual([
    {
      containerId: "container-1",
      documentId: null,
      localId: "note-1",
    },
  ]);
  expect(relinkInputs).toEqual([
    {
      accessEpoch: 1,
      containerId: "trash-container",
      documentId: null,
      localId: "note-1",
      queueBaselineAfterRelink: undefined,
    },
  ]);
  expect(mergedDocuments).toEqual([moved.note]);
  expect(updatedRuntimes).toEqual(["runtime:trash-container"]);
  expect(requestedSyncs).toEqual(["sync"]);
  expect(expandedNodes).toEqual(["trash-container"]);
  expect(logs).toEqual([
    "Container contents: moved local note note-1 to trash-container",
  ]);
});

test("moveDocumentLink queues synced document moves and applies the local projection", async () => {
  const { close, execSql } = await createTestExecSql(
    "containerContents-document-structure-queued-move",
  );

  try {
    const logs: string[] = [];
    const scheduledSyncs: string[] = [];
    const expandedNodes: string[] = [];
    const mergedDocuments: DocumentSummary[] = [];
    const relinkInputs: DocumentStructuralMutationRelinkInput[] = [];
    const linkedContainersByDocument = new Map<string, ReadonlyArray<string>>();
    const host: DocumentStructuralMutationHost<string> = {
      documentWorkflowRuntime: (containerId) => `runtime:${containerId}`,
      mergeDocumentSummary: (document) => {
        mergedDocuments.push(document);
      },
      openDocumentStore: () => ({
        ensureInitialized: async () => true,
        relink: async (input) => {
          relinkInputs.push(input);
          return {
            id: input.localId,
            containerId: input.containerId,
            documentId: input.documentId,
            title: "Queued move note",
            updatedAt: "2026-05-09T00:00:02.000Z",
          };
        },
        requestSync: () => {
          throw new Error("Queued document moves use structural sync.");
        },
        updateRuntime: () => undefined,
      }),
    };
    await sqlDocumentContainerProjectionPersistence.replaceDocumentLinks(
      execSql,
      "document-1",
      ["container-1"],
    );

    const moved = await moveDocumentLink({
      expandNode: (nodeId) => {
        expandedNodes.push(nodeId);
      },
      host,
      note: createNote(),
      replaceLinkedContainers: true,
      runtime: createRuntime(logs, execSql),
      scheduleSync: () => {
        scheduledSyncs.push("sync");
      },
      setLinkedContainerIdsForDocument: (documentId, containerIds) => {
        linkedContainersByDocument.set(documentId, containerIds);
      },
      targetContainerId: "trash-container",
    });

    if (!moved.note) {
      throw new Error("Expected queued move to return a moved note.");
    }
    expect(moved.note?.containerId).toBe("trash-container");
    expect(relinkInputs).toEqual([
      {
        accessEpoch: 1,
        containerId: "trash-container",
        documentId: "document-1",
        localId: "note-1",
        queueBaselineAfterRelink: undefined,
      },
    ]);
    expect(mergedDocuments).toEqual([moved.note]);
    expect(expandedNodes).toEqual(["trash-container"]);
    expect(scheduledSyncs).toEqual(["sync"]);
    expect(linkedContainersByDocument.get("document-1")).toEqual([
      "trash-container",
    ]);
    await expect(
      sqlDocumentContainerProjectionPersistence.listLinkedContainerIds(
        execSql,
        "document-1",
      ),
    ).resolves.toEqual(["trash-container"]);
    await expect(
      sqlDocumentMoveIntentPersistence.listPendingMoveIntents(execSql),
    ).resolves.toMatchObject([
      {
        documentId: "document-1",
        localId: "note-1",
        replaceLinkedContainers: true,
        sourceContainerId: "container-1",
        targetContainerId: "trash-container",
      },
    ]);
    expect(logs).toEqual([
      "Container contents: queued note note-1 move to trash-container",
    ]);
  } finally {
    close();
  }
});

test("activateDocumentLink relinks the local document without requesting remote sync", async () => {
  const logs: string[] = [];
  const mergedDocuments: DocumentSummary[] = [];
  const relinkInputs: DocumentStructuralMutationRelinkInput[] = [];
  const requestedSyncs: string[] = [];
  const updatedRuntimes: string[] = [];
  const host: DocumentStructuralMutationHost<string> = {
    documentWorkflowRuntime: (containerId) => `runtime:${containerId}`,
    mergeDocumentSummary: (document) => {
      mergedDocuments.push(document);
    },
    openDocumentStore: () => ({
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

  const activated = await activateDocumentLink({
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
    "Container contents: switched active note note-1 to container-2",
  ]);
});

test("activateDocumentLink skips documents that are not locally ready", async () => {
  const logs: string[] = [];
  const host: DocumentStructuralMutationHost<string> = {
    documentWorkflowRuntime: (containerId) => `runtime:${containerId}`,
    mergeDocumentSummary: () => {
      throw new Error("mergeDocumentSummary should not be called.");
    },
    openDocumentStore: () => ({
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

  const activated = await activateDocumentLink({
    host,
    note: createNote(),
    runtime: createRuntime(logs),
    targetContainerId: "container-2",
  });

  expect(activated).toBeNull();
  expect(logs).toEqual([
    "Container contents: note note-1 is not ready to mutate locally",
  ]);
});

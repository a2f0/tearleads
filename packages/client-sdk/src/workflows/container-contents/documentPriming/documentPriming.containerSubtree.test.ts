import { expect, test } from "bun:test";
import { createDocument, encodeVersionVector } from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import { sqlDocumentsPersistence } from "../../../data/persistence/documents/documentsPersistence";
import { defaultContainerContentsPersistence } from "../containerPersistence";
import { saveTestDocument } from "../documentQueries/documentQueries.testFixtures";
import { createContainerDocumentQueriesFromRuntime } from "../documentQueries/index";
import { primeDocumentsForContainerSubtree } from "./index";

test("primeDocumentsForContainerSubtree primes matching document stores", async () => {
  const { close, execSql } = await createTestExecSql(
    "containerContents-document-subtree-prime",
  );
  try {
    const runtime = { infra: { execSql } };
    const readModel = createContainerDocumentQueriesFromRuntime(runtime);
    await readModel.upsertDiscoveredDocuments([
      {
        accessEpoch: 1,
        accessStateHash: "access-state-hash-1",
        containerId: "private-container",
        createdAt: "2026-05-09T00:00:00.000Z",
        documentId: "remote-document-1",
        linkedContainerIds: ["private-container", "shared-child"],
      },
      {
        accessEpoch: 1,
        accessStateHash: "access-state-hash-2",
        containerId: "private-container-2",
        createdAt: "2026-05-09T00:00:01.000Z",
        documentId: "remote-document-2",
        linkedContainerIds: ["private-container-2", "shared-child"],
      },
      {
        accessEpoch: 1,
        accessStateHash: "access-state-hash-3",
        containerId: "unrelated-container",
        createdAt: "2026-05-09T00:00:02.000Z",
        documentId: "remote-document-3",
        linkedContainerIds: ["unrelated-container"],
      },
    ]);
    await readModel.replaceDocumentLinksBatch([
      {
        documentId: "remote-document-1",
        containerIds: ["private-container", "shared-child"],
      },
      {
        documentId: "remote-document-2",
        containerIds: ["private-container-2", "shared-child"],
      },
      {
        documentId: "remote-document-3",
        containerIds: ["unrelated-container"],
      },
    ]);

    const primedStores: Array<{
      documentId: string | null;
      localId: string;
      runtime: { containerId: string | null };
    }> = [];
    const createdRuntimeContainerIds: Array<string | null> = [];
    const syncRequests: string[] = [];
    const primedCount = await primeDocumentsForContainerSubtree({
      containersById: new Map([
        [
          "shared-root",
          {
            container: {
              id: "shared-root",
              parentId: null,
            },
          },
        ],
        [
          "shared-child",
          {
            container: {
              id: "shared-child",
              parentId: "shared-root",
            },
          },
        ],
        [
          "unrelated-container",
          {
            container: {
              id: "unrelated-container",
              parentId: null,
            },
          },
        ],
      ]),
      host: {
        documentWorkflowRuntime: (containerId) => {
          createdRuntimeContainerIds.push(containerId);
          return { containerId };
        },
        openDocumentStore: (input) => {
          primedStores.push(input);
          return {
            getSnapshot: () => ({ ready: true }),
            requestSync: () => {
              syncRequests.push(input.localId);
            },
          };
        },
      },
      rootContainerId: "shared-root",
      runtime,
    });

    primedStores.sort((left, right) =>
      left.localId.localeCompare(right.localId),
    );

    expect(primedCount).toBe(2);
    expect(createdRuntimeContainerIds).toEqual(["shared-child"]);
    expect(primedStores).toEqual([
      {
        documentId: "remote-document-1",
        localId: "remote-document-1",
        runtime: {
          containerId: "shared-child",
        },
      },
      {
        documentId: "remote-document-2",
        localId: "remote-document-2",
        runtime: {
          containerId: "shared-child",
        },
      },
    ]);
    expect(syncRequests.sort()).toEqual([
      "remote-document-1",
      "remote-document-2",
    ]);
  } finally {
    close();
  }
});

test("primeDocumentsForContainerSubtree lets initializing document stores schedule their own sync", async () => {
  const { close, execSql } = await createTestExecSql(
    "containerContents-document-subtree-prime-initializing",
  );
  try {
    const runtime = { infra: { execSql } };
    const readModel = createContainerDocumentQueriesFromRuntime(runtime);
    await readModel.upsertDiscoveredDocuments([
      {
        accessEpoch: 1,
        accessStateHash: "access-state-hash-1",
        containerId: "shared-root",
        createdAt: "2026-05-09T00:00:00.000Z",
        documentId: "remote-document-1",
        linkedContainerIds: ["shared-root"],
      },
    ]);

    const syncRequests: string[] = [];
    const primedCount = await primeDocumentsForContainerSubtree({
      containersById: new Map([
        [
          "shared-root",
          {
            container: {
              id: "shared-root",
              parentId: null,
            },
          },
        ],
      ]),
      host: {
        documentWorkflowRuntime: (containerId) => ({ containerId }),
        openDocumentStore: (input) => ({
          getSnapshot: () => ({ ready: false }),
          requestSync: () => {
            syncRequests.push(input.localId);
          },
        }),
      },
      rootContainerId: "shared-root",
      runtime,
    });

    expect(primedCount).toBe(1);
    expect(syncRequests).toEqual([]);
  } finally {
    close();
  }
});

// Settled documents stay closed; durable work and new shares still prime.
test("primeDocumentsForContainerSubtree skips settled documents", async () => {
  const { close, execSql } = await createTestExecSql(
    "containerContents-document-subtree-prime-settled",
  );
  try {
    const runtime = { infra: { execSql } };
    await defaultContainerContentsPersistence.ensureSchema(execSql);
    await sqlDocumentsPersistence.ensureSchema(execSql);

    const settledDoc = await createDocument("prime-settled-doc");
    settledDoc.getText("text").update("settled");
    settledDoc.commit();
    await sqlDocumentsPersistence.saveDocument(
      execSql,
      {
        accessEpoch: 1,
        containerId: "shared-root",
        documentId: "remote-settled",
        documentKind: "note",
        id: "settled-document",
        pendingBaseVersion: encodeVersionVector(settledDoc),
        snapshotEndVersion: encodeVersionVector(settledDoc),
        text: "settled",
        title: "Settled",
      },
      { updatedAt: "2026-07-20T00:00:00.000Z" },
    );

    const pendingDoc = await createDocument("prime-pending-doc");
    pendingDoc.getText("text").update("baseline");
    pendingDoc.commit();
    const pendingBaseVersion = encodeVersionVector(pendingDoc);
    pendingDoc.getText("text").update("deferred tail");
    pendingDoc.commit();
    await sqlDocumentsPersistence.saveDocument(
      execSql,
      {
        accessEpoch: 1,
        containerId: "shared-root",
        documentId: "remote-pending",
        documentKind: "note",
        id: "pending-document",
        pendingBaseVersion,
        snapshotEndVersion: encodeVersionVector(pendingDoc),
        text: "deferred tail",
        title: "Pending",
      },
      { updatedAt: "2026-07-20T00:00:01.000Z" },
    );

    // Never-hydrated discovered document: empty snapshotEndVersion, remote id
    // known.
    await saveTestDocument({
      containerId: "shared-root",
      documentId: "remote-discovered",
      execSql,
      id: "discovered-document",
      snapshotEndVersion: "",
      title: "Discovered",
      updatedAt: "2026-07-20T00:00:02.000Z",
    });

    const primedLocalIds: string[] = [];
    const primedCount = await primeDocumentsForContainerSubtree({
      containersById: new Map([
        ["shared-root", { container: { id: "shared-root", parentId: null } }],
      ]),
      host: {
        documentWorkflowRuntime: (containerId) => ({ containerId }),
        openDocumentStore: (input) => {
          primedLocalIds.push(input.localId);
          return {
            getSnapshot: () => ({ ready: true }),
            requestSync: () => undefined,
          };
        },
      },
      rootContainerId: "shared-root",
      runtime,
    });

    expect(primedLocalIds.sort()).toEqual([
      "discovered-document",
      "pending-document",
    ]);
    expect(primedCount).toBe(2);
  } finally {
    close();
  }
});

// Covers the chunked open path: more prime targets than PRIME_OPEN_CHUNK_SIZE
// (8) must all still prime, with the pass yielding between chunks.
test("primeDocumentsForContainerSubtree primes a backlog larger than one chunk", async () => {
  const { close, execSql } = await createTestExecSql(
    "containerContents-document-subtree-prime-chunked",
  );
  try {
    const runtime = { infra: { execSql } };
    await defaultContainerContentsPersistence.ensureSchema(execSql);
    await sqlDocumentsPersistence.ensureSchema(execSql);

    const expectedLocalIds: string[] = [];
    for (let index = 0; index < 10; index += 1) {
      const localId = `backlog-${String(index).padStart(2, "0")}`;
      expectedLocalIds.push(localId);
      // Local-only creates (no remote id, never hydrated): always prime.
      await saveTestDocument({
        containerId: "shared-root",
        documentId: null,
        execSql,
        id: localId,
        title: `Backlog ${index}`,
        updatedAt: `2026-07-20T00:01:${String(index).padStart(2, "0")}.000Z`,
      });
    }

    const primedLocalIds: string[] = [];
    const primedCount = await primeDocumentsForContainerSubtree({
      containersById: new Map([
        ["shared-root", { container: { id: "shared-root", parentId: null } }],
      ]),
      host: {
        documentWorkflowRuntime: (containerId) => ({ containerId }),
        openDocumentStore: (input) => {
          primedLocalIds.push(input.localId);
          return {
            getSnapshot: () => ({ ready: true }),
            requestSync: () => undefined,
          };
        },
      },
      rootContainerId: "shared-root",
      runtime,
    });

    expect(primedLocalIds.sort()).toEqual(expectedLocalIds);
    expect(primedCount).toBe(10);
  } finally {
    close();
  }
});

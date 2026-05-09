import { expect, test } from "bun:test";
import { createTestExecSql } from "../../../test/helpers/createTestExecSql";
import {
  createExplorerDocumentReadModelFromRuntime,
  listExplorerDocumentRuntimeTargetsForContainerSubtreeFromRuntime,
  primeExplorerDocumentsForContainerSubtree,
} from "./documentReadModel";

test("createExplorerDocumentReadModelFromRuntime uses the runtime executor", async () => {
  const { close, execSql } = await createTestExecSql(
    "explorer-document-read-model-runtime",
  );
  try {
    const readModel = createExplorerDocumentReadModelFromRuntime({ execSql });
    const watermark = {
      id: "document-1",
      updatedAt: "2026-05-09T00:00:00.000Z",
    };

    await readModel.saveContainerDocumentWatermark("container-1", watermark);

    expect(
      await readModel.loadContainerDocumentWatermark("container-1"),
    ).toEqual(watermark);
  } finally {
    close();
  }
});

test("listExplorerDocumentRuntimeTargetsForContainerSubtreeFromRuntime uses the runtime executor", async () => {
  const { close, execSql } = await createTestExecSql(
    "explorer-document-runtime-targets",
  );
  try {
    const readModel = createExplorerDocumentReadModelFromRuntime({ execSql });
    await readModel.upsertDiscoveredDocuments([
      {
        accessEpoch: 1,
        accessStateHash: "access-state-hash-1",
        containerId: "private-container",
        createdAt: "2026-05-09T00:00:00.000Z",
        documentId: "remote-document-1",
        linkedContainerIds: ["private-container", "shared-root"],
      },
    ]);
    await readModel.replaceDocumentLinks("remote-document-1", [
      "private-container",
      "shared-root",
    ]);

    const targets =
      await listExplorerDocumentRuntimeTargetsForContainerSubtreeFromRuntime({
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
        rootContainerId: "shared-root",
        runtime: { execSql },
      });

    expect(targets).toEqual([
      {
        documentId: "remote-document-1",
        localId: "remote-document-1",
        runtimeContainerId: "shared-root",
      },
    ]);
  } finally {
    close();
  }
});

test("primeExplorerDocumentsForContainerSubtree primes matching document stores", async () => {
  const { close, execSql } = await createTestExecSql(
    "explorer-document-subtree-prime",
  );
  try {
    const readModel = createExplorerDocumentReadModelFromRuntime({ execSql });
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
    await readModel.replaceDocumentLinks("remote-document-1", [
      "private-container",
      "shared-child",
    ]);
    await readModel.replaceDocumentLinks("remote-document-2", [
      "private-container-2",
      "shared-child",
    ]);
    await readModel.replaceDocumentLinks("remote-document-3", [
      "unrelated-container",
    ]);

    const primedStores: Array<{
      documentId: string | null;
      localId: string;
      runtime: { containerId: string };
    }> = [];
    const createdRuntimeContainerIds: string[] = [];
    const syncRequests: string[] = [];
    const primedCount = await primeExplorerDocumentsForContainerSubtree({
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
        createDocumentRuntime: (containerId) => {
          createdRuntimeContainerIds.push(containerId);
          return { containerId };
        },
        primeDocumentStore: (input) => {
          primedStores.push(input);
          return {
            requestSync: () => {
              syncRequests.push(input.localId);
            },
          };
        },
      },
      rootContainerId: "shared-root",
      runtime: { execSql },
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

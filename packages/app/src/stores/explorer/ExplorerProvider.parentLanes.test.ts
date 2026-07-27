import { expect, test } from "bun:test";
import {
  createContainerContentsSyncLane as createExplorerContainerContentsSyncLane,
  createContainerParentSyncLane as createExplorerContainerParentSyncLane,
  createContainerContentsStore as createExplorerStore,
  defaultDocumentsPersistence,
  defaultContainerContentsPersistence as defaultExplorerPersistence,
  initializeDocumentLinksSchema as initializeExplorerDocumentLinksSchema,
  listDocumentLinkedContainerIds as listExplorerDocumentLinkedContainerIds,
  loadContainerSyncWatermark as loadExplorerContainerSyncWatermark,
  replaceDocumentLinks as replaceExplorerDocumentLinks,
  saveContainerSyncWatermark as saveExplorerContainerSyncWatermark,
} from "@tearleads/client-sdk";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import {
  createContainerParentLaneBatchMock as batchParentLanes,
  createMockApiClient,
} from "@tearleads/test-utils";
import {
  listContainersResponse,
  listedContainer,
  saveContainer,
  TEST_SYNC_TIMESTAMP,
} from "../../../test/helpers/explorer-provider/explorerProviderFixtures";
import {
  createSqlRuntime,
  runtimeWithPatch,
} from "../../../test/helpers/explorer-provider/explorerProviderHarness";
import { waitForCondition } from "../../../test/helpers/waitForCondition";

test("explorer sync hydrates container parent lanes concurrently", async () => {
  let runtime = await createSqlRuntime();
  const localKeyPair = generateKemSeedAndKeyPair();
  let activeListContainerCalls = 0;
  let maxActiveListContainerCalls = 0;
  const requestedParentIds: Array<string | null | undefined> = [];

  runtime = runtimeWithPatch(runtime, {
    apiClient: createMockApiClient({
      ...runtime.apiClient,
      listContainerParentLanes: batchParentLanes(async (options) => {
        requestedParentIds.push(options.parentId);
        activeListContainerCalls += 1;
        maxActiveListContainerCalls = Math.max(
          maxActiveListContainerCalls,
          activeListContainerCalls,
        );

        try {
          await new Promise((resolve) => {
            setTimeout(
              resolve,
              options.parentId === "parent-a" || options.parentId === "parent-b"
                ? 50
                : 0,
            );
          });

          if (options.parentId === null || options.parentId === undefined) {
            return listContainersResponse([
              listedContainer({
                id: "parent-a",
                metadataAccessEpoch: 1,
                metadataAccessStateHash: "parent-a-access-state-hash-1",
                metadataDocumentId: "parent-a-metadata-document",
                organizationId: "org-1",
                parentId: null,
              }),
              listedContainer({
                id: "parent-b",
                metadataAccessEpoch: 1,
                metadataAccessStateHash: "parent-b-access-state-hash-1",
                metadataDocumentId: "parent-b-metadata-document",
                organizationId: "org-1",
                parentId: null,
              }),
            ]);
          }

          return listContainersResponse();
        } finally {
          activeListContainerCalls -= 1;
        }
      }),
    }),
    encapsulationKeyPair: localKeyPair,
    isAuthenticated: true,
    online: true,
  });
  let store: ReturnType<typeof createExplorerStore> | null = null;

  try {
    const createdStore = createExplorerStore(runtime);
    store = createdStore;
    createdStore.updateRuntime(runtime);
    await waitForCondition(
      () => createdStore.getSnapshot().ready,
      "Explorer store did not become ready.",
    );
    await expect(createdStore.refresh()).resolves.toBe(true);

    await waitForCondition(
      () =>
        maxActiveListContainerCalls > 1 &&
        requestedParentIds.includes("parent-a") &&
        requestedParentIds.includes("parent-b") &&
        createdStore
          .getSnapshot()
          .nodes.some((node) => node.id === "parent-a") &&
        createdStore.getSnapshot().nodes.some((node) => node.id === "parent-b"),
      "Explorer sync did not hydrate sibling parent lanes concurrently.",
    );

    expect(maxActiveListContainerCalls).toBeGreaterThan(1);
  } finally {
    if (store) {
      store.updateRuntime(
        runtimeWithPatch(runtime, { dbStatus: "terminated" }),
      );
    }
    runtime.close();
  }
});

test("explorer sync retries failed parent lane batches without advancing their watermarks", async () => {
  let runtime = await createSqlRuntime();
  const localKeyPair = generateKemSeedAndKeyPair();
  let parentAFetchCount = 0;
  let parentBFetchCount = 0;

  runtime = runtimeWithPatch(runtime, {
    apiClient: createMockApiClient({
      ...runtime.apiClient,
      listContainerParentLanes: batchParentLanes(async (options) => {
        await Promise.resolve();

        if (options.parentId === null || options.parentId === undefined) {
          return options.watermark
            ? listContainersResponse()
            : listContainersResponse([
                listedContainer({
                  id: "parent-a",
                  metadataAccessEpoch: 1,
                  metadataAccessStateHash: "parent-a-access-state-hash-1",
                  metadataDocumentId: "parent-a-metadata-document",
                  organizationId: "org-1",
                  parentId: null,
                }),
                listedContainer({
                  id: "parent-b",
                  metadataAccessEpoch: 1,
                  metadataAccessStateHash: "parent-b-access-state-hash-1",
                  metadataDocumentId: "parent-b-metadata-document",
                  organizationId: "org-1",
                  parentId: null,
                }),
              ]);
        }

        if (options.parentId === "parent-a") {
          parentAFetchCount += 1;
          if (parentAFetchCount === 1) {
            return null;
          }

          return listContainersResponse([
            listedContainer({
              id: "child-a",
              metadataAccessEpoch: 1,
              metadataAccessStateHash: "child-a-access-state-hash-1",
              metadataDocumentId: "child-a-metadata-document",
              organizationId: "org-1",
              parentId: "parent-a",
            }),
          ]);
        }

        if (options.parentId === "parent-b") {
          parentBFetchCount += 1;
          return listContainersResponse([
            listedContainer({
              id: "child-b",
              metadataAccessEpoch: 1,
              metadataAccessStateHash: "child-b-access-state-hash-1",
              metadataDocumentId: "child-b-metadata-document",
              organizationId: "org-1",
              parentId: "parent-b",
            }),
          ]);
        }

        return listContainersResponse();
      }),
    }),
    encapsulationKeyPair: localKeyPair,
    isAuthenticated: true,
    online: true,
  });
  let store: ReturnType<typeof createExplorerStore> | null = null;

  try {
    await defaultExplorerPersistence.ensureSchema(runtime.infra.execSql);
    await saveContainer(runtime.infra.execSql, {
      id: "local-cache-placeholder",
      organizationId: "org-1",
      parentId: null,
      metadataDocumentId: null,
      name: "Local Cache",
      icon: null,
    });

    const createdStore = createExplorerStore(runtime);
    store = createdStore;
    createdStore.updateRuntime(runtime);
    await waitForCondition(
      () => createdStore.getSnapshot().ready,
      "Explorer store did not become ready.",
    );
    await expect(createdStore.refresh()).resolves.toBe(true);

    await waitForCondition(
      () =>
        parentAFetchCount === 1 &&
        parentBFetchCount === 1 &&
        createdStore
          .getSnapshot()
          .nodes.some((node) => node.id === "parent-a") &&
        createdStore
          .getSnapshot()
          .nodes.some((node) => node.id === "parent-b") &&
        !createdStore.getSnapshot().nodes.some((node) => node.id === "child-b"),
      "Explorer sync did not stop the failed parent lane batch.",
    );

    await expect(
      loadExplorerContainerSyncWatermark(
        runtime.infra.execSql,
        createExplorerContainerParentSyncLane("parent-a"),
      ),
    ).resolves.toBeNull();
    await expect(
      loadExplorerContainerSyncWatermark(
        runtime.infra.execSql,
        createExplorerContainerParentSyncLane("parent-b"),
      ),
    ).resolves.toBeNull();

    await expect(createdStore.refresh()).resolves.toBe(true);

    await waitForCondition(
      () =>
        createdStore
          .getSnapshot()
          .nodes.some((node) => node.id === "child-a") &&
        createdStore.getSnapshot().nodes.some((node) => node.id === "child-b"),
      "Explorer sync did not retry the failed parent lane batch.",
    );

    await expect(
      loadExplorerContainerSyncWatermark(
        runtime.infra.execSql,
        createExplorerContainerParentSyncLane("parent-a"),
      ),
    ).resolves.toEqual({
      id: "child-a",
      updatedAt: TEST_SYNC_TIMESTAMP,
    });
    await expect(
      loadExplorerContainerSyncWatermark(
        runtime.infra.execSql,
        createExplorerContainerParentSyncLane("parent-b"),
      ),
    ).resolves.toEqual({
      id: "child-b",
      updatedAt: TEST_SYNC_TIMESTAMP,
    });
  } finally {
    if (store) {
      store.updateRuntime(
        runtimeWithPatch(runtime, { dbStatus: "terminated" }),
      );
    }
    runtime.close();
  }
});

test("explorer sync applies container tombstones before advancing the parent watermark", async () => {
  let runtime = await createSqlRuntime();
  const localKeyPair = generateKemSeedAndKeyPair();

  runtime = runtimeWithPatch(runtime, {
    apiClient: createMockApiClient({
      ...runtime.apiClient,
      listContainerParentLanes: batchParentLanes(async (options) => {
        if (options.parentId === "child-container") {
          return listContainersResponse([
            listedContainer({
              id: "grandchild-container",
              metadataAccessEpoch: 1,
              metadataAccessStateHash: "grandchild-access-state-hash-1",
              metadataDocumentId: "grandchild-metadata-document",
              organizationId: "org-1",
              parentId: "child-container",
            }),
          ]);
        }

        if (options.parentId === "root-container") {
          return {
            hasMore: false,
            items: [],
            nextWatermark: {
              id: "child-container",
              updatedAt: "2026-05-05T00:00:02.000Z",
            },
            tombstones: [
              {
                containerId: "child-container",
                depth: 1,
                parentId: "root-container",
                reason: "access_revoked",
                updatedAt: "2026-05-05T00:00:02.000Z",
              },
            ],
          };
        }

        return listContainersResponse();
      }),
    }),
    encapsulationKeyPair: localKeyPair,
    isAuthenticated: true,
    online: true,
  });
  let store: ReturnType<typeof createExplorerStore> | null = null;

  try {
    await defaultExplorerPersistence.ensureSchema(runtime.infra.execSql);
    await defaultDocumentsPersistence.ensureSchema(runtime.infra.execSql);
    await initializeExplorerDocumentLinksSchema(runtime.infra.execSql);

    await saveContainer(runtime.infra.execSql, {
      id: "root-container",
      organizationId: "org-1",
      parentId: null,
      metadataDocumentId: null,
      name: "/",
      icon: null,
    });
    await saveContainer(runtime.infra.execSql, {
      id: "child-container",
      organizationId: "org-1",
      parentId: "root-container",
      metadataDocumentId: null,
      name: "Child",
      icon: null,
    });
    await saveContainer(runtime.infra.execSql, {
      id: "archive-container",
      organizationId: "org-1",
      parentId: "root-container",
      metadataDocumentId: null,
      name: "Archive",
      icon: null,
    });
    await saveContainer(runtime.infra.execSql, {
      id: "grandchild-container",
      organizationId: "org-1",
      parentId: "child-container",
      metadataDocumentId: null,
      name: "Grandchild",
      icon: null,
    });
    await defaultDocumentsPersistence.saveDocument(
      runtime.infra.execSql,
      {
        accessEpoch: 1,
        accessStateHash: "document-access-state-hash-1",
        containerId: "child-container",
        documentId: "remote-document",
        id: "local-document",
        lastCommitLsn: null,
        snapshotEndVersion: "",
        text: "Shared document",
      },
      { updatedAt: "2026-05-05T00:00:00.000Z" },
    );
    await replaceExplorerDocumentLinks(
      runtime.infra.execSql,
      "remote-document",
      ["archive-container", "child-container"],
    );
    await saveExplorerContainerSyncWatermark(
      runtime.infra.execSql,
      createExplorerContainerParentSyncLane("child-container"),
      {
        id: "previous-child-lane",
        updatedAt: "2026-05-04T00:00:00.000Z",
      },
    );
    await saveExplorerContainerSyncWatermark(
      runtime.infra.execSql,
      createExplorerContainerContentsSyncLane("child-container"),
      {
        id: "previous-document-lane",
        updatedAt: "2026-05-04T00:00:00.000Z",
      },
    );
    await saveExplorerContainerSyncWatermark(
      runtime.infra.execSql,
      createExplorerContainerParentSyncLane("grandchild-container"),
      {
        id: "previous-grandchild-lane",
        updatedAt: "2026-05-04T00:00:00.000Z",
      },
    );

    const createdStore = createExplorerStore(runtime);
    store = createdStore;
    createdStore.updateRuntime(runtime);

    await waitForCondition(
      async () =>
        (await createdStore.refresh()) &&
        createdStore
          .getSnapshot()
          .nodes.some((node) => node.id === "archive-container") &&
        !createdStore
          .getSnapshot()
          .nodes.some((node) => node.id === "child-container"),
      "Explorer sync did not apply the container tombstone.",
    );

    expect(
      createdStore
        .getSnapshot()
        .nodes.some((node) => node.id === "root-container"),
    ).toBe(true);
    expect(
      createdStore
        .getSnapshot()
        .nodes.some((node) => node.id === "archive-container"),
    ).toBe(true);
    expect(
      createdStore
        .getSnapshot()
        .nodes.some((node) => node.id === "grandchild-container"),
    ).toBe(false);
    await expect(
      loadExplorerContainerSyncWatermark(
        runtime.infra.execSql,
        createExplorerContainerParentSyncLane("root-container"),
      ),
    ).resolves.toEqual({
      id: "child-container",
      updatedAt: "2026-05-05T00:00:02.000Z",
    });
    await expect(
      loadExplorerContainerSyncWatermark(
        runtime.infra.execSql,
        createExplorerContainerParentSyncLane("child-container"),
      ),
    ).resolves.toBeNull();
    await expect(
      loadExplorerContainerSyncWatermark(
        runtime.infra.execSql,
        createExplorerContainerContentsSyncLane("child-container"),
      ),
    ).resolves.toBeNull();
    await expect(
      loadExplorerContainerSyncWatermark(
        runtime.infra.execSql,
        createExplorerContainerParentSyncLane("grandchild-container"),
      ),
    ).resolves.toBeNull();
    await expect(
      listExplorerDocumentLinkedContainerIds(
        runtime.infra.execSql,
        "remote-document",
      ),
    ).resolves.toEqual(["archive-container"]);

    const repairedDocument = await defaultDocumentsPersistence.loadDocument(
      runtime.infra.execSql,
      "local-document",
    );
    expect(repairedDocument?.containerId).toBe("archive-container");
  } finally {
    if (store) {
      store.updateRuntime(
        runtimeWithPatch(runtime, { dbStatus: "terminated" }),
      );
    }
    runtime.close();
  }
});

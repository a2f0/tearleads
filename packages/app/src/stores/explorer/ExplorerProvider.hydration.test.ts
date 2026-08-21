import { expect, test } from "bun:test";
import {
  createContainerDocumentObjectSyncState,
  createContainerContentsStore as createExplorerStore,
  createInitializedContainerMetadataDocument,
  defaultDocumentsPersistence,
  defaultContainerContentsPersistence as defaultExplorerPersistence,
  type DocumentRecord as StoredDocumentRecord,
} from "@symcrypt/client-sdk";
import { generateKemSeedAndKeyPair } from "@symcrypt/crypto";
import { bytesToBase64 } from "@symcrypt/encoding";
import {
  createContainerParentLaneBatchMock,
  createMockApiClient,
} from "@symcrypt/test-utils";
import {
  ensureContainerTables,
  ensureDocumentTables,
  listContainersResponse,
  listedContainer,
  loadContainers,
  saveContainer,
  saveDocumentRecord,
} from "../../../test/helpers/explorer-provider/explorerProviderFixtures";
import {
  createSqlRuntime,
  runtimeWithPatch,
} from "../../../test/helpers/explorer-provider/explorerProviderHarness";
import { waitForCondition } from "../../../test/helpers/waitForCondition";

test("explorer hydration repairs stale local timestamps for remote containers without pending metadata", async () => {
  let runtime = await createSqlRuntime();
  const remoteUpdatedAt = "2026-05-05T00:00:00.000Z";
  const staleLocalUpdatedAt = "2026-05-05T00:00:01.000Z";
  const listContainerIdsWithPendingUpdatesCalls: string[][] = [];
  let listPendingUpdateCalls = 0;
  let store: ReturnType<typeof createExplorerStore> | null = null;
  const persistence: typeof defaultExplorerPersistence = {
    ...defaultExplorerPersistence,
    async listContainerIdsWithPendingUpdates(execSql, containerIds) {
      listContainerIdsWithPendingUpdatesCalls.push([...containerIds].sort());
      return defaultExplorerPersistence.listContainerIdsWithPendingUpdates(
        execSql,
        containerIds,
      );
    },
    async listPendingUpdates(execSql, containerId) {
      listPendingUpdateCalls += 1;
      return defaultExplorerPersistence.listPendingUpdates(
        execSql,
        containerId,
      );
    },
  };

  async function saveStaleRemoteContainer(input: {
    id: string;
    metadataAccessStateHash: string;
    metadataDocumentId: string;
    name: string;
    parentId: string | null;
  }) {
    const { initialUpdate } = await createInitializedContainerMetadataDocument(
      input.id,
      {
        icon: null,
        name: input.name,
      },
    );
    await saveContainer(
      runtime.infra.execSql,
      {
        id: input.id,
        icon: null,
        metadataDocumentId: input.metadataDocumentId,
        name: input.name,
        organizationId: "org-2",
        parentId: input.parentId,
      },
      {
        localUpdatedAt: staleLocalUpdatedAt,
        serverTimestamps: {
          createdAt: remoteUpdatedAt,
          updatedAt: remoteUpdatedAt,
        },
      },
    );
    await saveDocumentRecord(
      runtime.infra.execSql,
      {
        appKind: "container-metadata",
        localId: input.id,
      },
      {
        accessEpoch: 1,
        accessStateHash: input.metadataAccessStateHash,
        documentId: input.metadataDocumentId,
        id: input.id,
        lastCommitLsn: null,
        metadataUpdates: bytesToBase64(initialUpdate),
        snapshotEndVersion: "",
      },
      staleLocalUpdatedAt,
    );
  }

  runtime = runtimeWithPatch(runtime, {
    apiClient: createMockApiClient({
      ...runtime.apiClient,
      listContainerParentLanes: createContainerParentLaneBatchMock(
        async (options) =>
          options.parentId === null || options.parentId === undefined
            ? listContainersResponse([
                listedContainer({
                  id: "shared-root-container",
                  metadataAccessEpoch: 1,
                  metadataAccessStateHash: "shared-root-access-state-hash-1",
                  metadataDocumentId: "shared-root-metadata-document",
                  organizationId: "org-2",
                  parentId: null,
                  updatedAt: remoteUpdatedAt,
                }),
              ])
            : listContainersResponse(
                options.parentId === "shared-root-container"
                  ? [
                      listedContainer({
                        id: "shared-child-container",
                        metadataAccessEpoch: 1,
                        metadataAccessStateHash:
                          "shared-child-access-state-hash-1",
                        metadataDocumentId: "shared-child-metadata-document",
                        organizationId: "org-2",
                        parentId: "shared-root-container",
                        updatedAt: remoteUpdatedAt,
                      }),
                      listedContainer({
                        id: "shared-child-container-b",
                        metadataAccessEpoch: 1,
                        metadataAccessStateHash:
                          "shared-child-b-access-state-hash-1",
                        metadataDocumentId: "shared-child-b-metadata-document",
                        organizationId: "org-2",
                        parentId: "shared-root-container",
                        updatedAt: remoteUpdatedAt,
                      }),
                    ]
                  : [],
              ),
      ),
    }),
    isAuthenticated: true,
    online: true,
  });

  try {
    await ensureContainerTables(runtime.infra.execSql);
    await ensureDocumentTables(runtime.infra.execSql);
    await saveStaleRemoteContainer({
      id: "shared-root-container",
      metadataAccessStateHash: "shared-root-access-state-hash-1",
      metadataDocumentId: "shared-root-metadata-document",
      name: "/",
      parentId: null,
    });
    await saveStaleRemoteContainer({
      id: "shared-child-container",
      metadataAccessStateHash: "shared-child-access-state-hash-1",
      metadataDocumentId: "shared-child-metadata-document",
      name: "Shared child",
      parentId: "shared-root-container",
    });
    await saveStaleRemoteContainer({
      id: "shared-child-container-b",
      metadataAccessStateHash: "shared-child-b-access-state-hash-1",
      metadataDocumentId: "shared-child-b-metadata-document",
      name: "Shared child B",
      parentId: "shared-root-container",
    });

    const createdStore = createExplorerStore(runtime, persistence);
    store = createdStore;
    createdStore.updateRuntime(runtime);

    await waitForCondition(async () => {
      const repairedNodes = (await createdStore.refresh())
        ? createdStore
            .getSnapshot()
            .nodes.filter((node) =>
              [
                "shared-root-container",
                "shared-child-container",
                "shared-child-container-b",
              ].includes(node.id),
            )
        : [];
      return (
        repairedNodes.length === 3 &&
        repairedNodes.every((node) => node.syncState.status === "synced")
      );
    }, "Explorer hydration did not repair stale local remote-container timestamps.");

    const refreshedNodes = createdStore.getSnapshot().nodes;
    expect(
      refreshedNodes.find((node) => node.id === "shared-root-container")
        ?.syncState,
    ).toEqual(createContainerDocumentObjectSyncState({}));
    expect(
      refreshedNodes.find((node) => node.id === "shared-child-container")
        ?.syncState,
    ).toEqual(createContainerDocumentObjectSyncState({}));
    expect(
      refreshedNodes.find((node) => node.id === "shared-child-container-b")
        ?.syncState,
    ).toEqual(createContainerDocumentObjectSyncState({}));
    await expect(loadContainers(runtime.infra.execSql)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "shared-root-container",
          localUpdatedAt: remoteUpdatedAt,
          serverUpdatedAt: remoteUpdatedAt,
        }),
        expect.objectContaining({
          id: "shared-child-container",
          localUpdatedAt: remoteUpdatedAt,
          serverUpdatedAt: remoteUpdatedAt,
        }),
        expect.objectContaining({
          id: "shared-child-container-b",
          localUpdatedAt: remoteUpdatedAt,
          serverUpdatedAt: remoteUpdatedAt,
        }),
      ]),
    );
    expect(listPendingUpdateCalls).toBe(0);
    expect(listContainerIdsWithPendingUpdatesCalls).toContainEqual([
      "shared-child-container",
      "shared-child-container-b",
    ]);
  } finally {
    if (store) {
      store.updateRuntime(
        runtimeWithPatch(runtime, { dbStatus: "terminated" }),
      );
    }
    runtime.close();
  }
});

test("explorer hydration reconciles a restored local-only root into the authenticated remote root", async () => {
  let runtime = await createSqlRuntime();
  const localKeyPair = generateKemSeedAndKeyPair();
  runtime = runtimeWithPatch(runtime, {
    apiClient: createMockApiClient({
      ...runtime.apiClient,
      listContainerParentLanes: createContainerParentLaneBatchMock(
        async (options) =>
          options.parentId === null || options.parentId === undefined
            ? listContainersResponse([
                listedContainer({
                  id: "remote-root",
                  metadataAccessEpoch: 1,
                  metadataAccessStateHash: "remote-root-access-state-hash-1",
                  metadataDocumentId: "remote-root-metadata-document",
                  organizationId: "org-remote",
                  parentId: null,
                }),
              ])
            : listContainersResponse(),
      ),
    }),
    encapsulationKeyPair: localKeyPair,
    isAuthenticated: true,
    online: true,
    organizationId: "org-remote",
  });

  await ensureContainerTables(runtime.infra.execSql);
  await ensureDocumentTables(runtime.infra.execSql);
  const localRoot = await defaultExplorerPersistence.saveContainer(
    runtime.infra.execSql,
    {
      id: "local-root",
      icon: null,
      metadataDocumentId: null,
      name: "/",
      organizationId: "",
      parentId: null,
    },
    null,
  );
  await defaultExplorerPersistence.saveContainer(
    runtime.infra.execSql,
    {
      id: "local-child",
      icon: null,
      metadataDocumentId: null,
      name: "Local child",
      organizationId: localRoot.organizationId,
      parentId: localRoot.id,
    },
    null,
    { createIntent: { parentContainerId: localRoot.id } },
  );
  const localNote: StoredDocumentRecord = {
    accessEpoch: 1,
    accessStateHash: null,
    containerId: localRoot.id,
    contentKeyBundle: null,
    documentId: null,
    documentKekTargets: null,
    documentKind: "note",
    documentManifestBundle: null,
    id: "local-note",
    lastCommitLsn: null,
    snapshotEndVersion: "",
    text: "Local note",
    title: "Local note",
  };
  await defaultDocumentsPersistence.saveDocument(
    runtime.infra.execSql,
    localNote,
    {
      updatedAt: "2026-05-05T00:00:00.000Z",
    },
  );

  let store: ReturnType<typeof createExplorerStore> | null = null;
  try {
    const createdStore = createExplorerStore(runtime);
    store = createdStore;
    createdStore.updateRuntime(runtime);

    await waitForCondition(
      async () =>
        (await createdStore.refresh()) &&
        createdStore
          .getSnapshot()
          .nodes.some(
            (node) =>
              node.id === "local-child" && node.parentId === "remote-root",
          ),
      "Explorer hydration did not reparent the local child to the remote root.",
    );

    const nodes = createdStore.getSnapshot().nodes;
    expect(nodes.some((node) => node.id === "local-root")).toBe(false);
    expect(nodes.some((node) => node.id === "remote-root")).toBe(true);

    const pendingIntents =
      await defaultExplorerPersistence.listPendingCreateIntents(
        runtime.infra.execSql,
      );
    expect(pendingIntents).toEqual([
      expect.objectContaining({
        containerId: "local-child",
        parentContainerId: "remote-root",
      }),
    ]);
    await expect(
      defaultDocumentsPersistence.loadDocument(
        runtime.infra.execSql,
        "local-note",
      ),
    ).resolves.toMatchObject({
      containerId: "remote-root",
      documentId: null,
      id: "local-note",
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

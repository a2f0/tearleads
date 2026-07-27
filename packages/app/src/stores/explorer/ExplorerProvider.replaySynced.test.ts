import { expect, test } from "bun:test";
import {
  createContainerContentsStore as createExplorerStore,
  createInitializedContainerMetadataDocument,
  defaultContainerContentsPersistence as defaultExplorerPersistence,
} from "@tearleads/client-sdk";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  createContainerParentLaneBatchMock,
  createMockApiClient,
} from "@tearleads/test-utils";
import {
  createExplorerMetadataContainerProjection,
  ensureContainerTables,
  ensureDocumentTables,
  listContainersResponse,
  listedContainer,
  loadContainers,
  saveContainer,
  saveDocumentRecord,
} from "../../../test/helpers/explorer-provider/explorerProviderFixtures";
import {
  createExplorerContainerApiHarness,
  createSqlRuntime,
  runtimeWithPatch,
} from "../../../test/helpers/explorer-provider/explorerProviderHarness";
import { waitForCondition } from "../../../test/helpers/waitForCondition";

test("explorer sync replays moved synced containers from disk after restart and login", async () => {
  let runtime = await createSqlRuntime();
  const localKeyPair = generateKemSeedAndKeyPair();
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const signingFingerprint = await toFingerprint(
    signingKeyPair.signingPublicKey,
  );
  const rootProjection = await createExplorerMetadataContainerProjection({
    containerId: "root-container",
    encapsulationPublicKey: localKeyPair.publicKey,
    organizationId: "org-1",
    signerKeyFingerprint: signingFingerprint,
    signerPrivateKey: signingKeyPair.signingPrivateKey,
    userId: "user-1",
  });
  const parentAProjection = await createExplorerMetadataContainerProjection({
    containerId: "parent-a",
    encapsulationPublicKey: localKeyPair.publicKey,
    organizationId: "org-1",
    parentProjection: rootProjection,
    signerKeyFingerprint: signingFingerprint,
    signerPrivateKey: signingKeyPair.signingPrivateKey,
    userId: "user-1",
  });
  const parentBProjection = await createExplorerMetadataContainerProjection({
    containerId: "parent-b",
    encapsulationPublicKey: localKeyPair.publicKey,
    organizationId: "org-1",
    parentProjection: rootProjection,
    signerKeyFingerprint: signingFingerprint,
    signerPrivateKey: signingKeyPair.signingPrivateKey,
    userId: "user-1",
  });
  const childProjection = await createExplorerMetadataContainerProjection({
    containerId: "child-container",
    encapsulationPublicKey: localKeyPair.publicKey,
    organizationId: "org-1",
    parentProjection: parentAProjection,
    signerKeyFingerprint: signingFingerprint,
    signerPrivateKey: signingKeyPair.signingPrivateKey,
    userId: "user-1",
  });
  const harness = createExplorerContainerApiHarness([
    rootProjection,
    parentAProjection,
    parentBProjection,
    childProjection,
  ]);
  let remoteContainers = [
    listedContainer({
      id: "root-container",
      metadataAccessEpoch: 1,
      metadataAccessStateHash: "root-access-state-hash-1",
      metadataDocumentId: "root-metadata-document",
      organizationId: "org-1",
      parentId: null,
    }),
    listedContainer({
      id: "parent-a",
      metadataAccessEpoch: 1,
      metadataAccessStateHash: "parent-a-access-state-hash-1",
      metadataDocumentId: "parent-a-metadata-document",
      organizationId: "org-1",
      parentId: "root-container",
    }),
    listedContainer({
      id: "parent-b",
      metadataAccessEpoch: 1,
      metadataAccessStateHash: "parent-b-access-state-hash-1",
      metadataDocumentId: "parent-b-metadata-document",
      organizationId: "org-1",
      parentId: "root-container",
    }),
    listedContainer({
      id: "child-container",
      metadataAccessEpoch: 1,
      metadataAccessStateHash: "child-access-state-hash-1",
      metadataDocumentId: "child-metadata-document",
      organizationId: "org-1",
      parentId: "parent-a",
    }),
  ];
  let firstStore: ReturnType<typeof createExplorerStore> | null = null;
  let secondStore: ReturnType<typeof createExplorerStore> | null = null;

  async function saveSyncedContainer(input: {
    id: string;
    metadataAccessStateHash: string;
    metadataDocumentId: string;
    name: string;
    parentId: string | null;
  }) {
    const syncedAt = "2026-05-05T00:00:00.000Z";
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
        organizationId: "org-1",
        parentId: input.parentId,
      },
      {
        localUpdatedAt: syncedAt,
        serverTimestamps: {
          createdAt: syncedAt,
          updatedAt: syncedAt,
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
      syncedAt,
    );
  }

  try {
    await ensureContainerTables(runtime.infra.execSql);
    await ensureDocumentTables(runtime.infra.execSql);
    await saveSyncedContainer({
      id: "root-container",
      metadataAccessStateHash: "root-access-state-hash-1",
      metadataDocumentId: "root-metadata-document",
      name: "/",
      parentId: null,
    });
    await saveSyncedContainer({
      id: "parent-a",
      metadataAccessStateHash: "parent-a-access-state-hash-1",
      metadataDocumentId: "parent-a-metadata-document",
      name: "Parent A",
      parentId: "root-container",
    });
    await saveSyncedContainer({
      id: "parent-b",
      metadataAccessStateHash: "parent-b-access-state-hash-1",
      metadataDocumentId: "parent-b-metadata-document",
      name: "Parent B",
      parentId: "root-container",
    });
    await saveSyncedContainer({
      id: "child-container",
      metadataAccessStateHash: "child-access-state-hash-1",
      metadataDocumentId: "child-metadata-document",
      name: "Child",
      parentId: "parent-a",
    });

    const offlineRuntime = runtimeWithPatch(runtime, {
      isAuthenticated: false,
      online: false,
    });
    firstStore = createExplorerStore(offlineRuntime);
    firstStore.updateRuntime(offlineRuntime);

    await waitForCondition(
      () => firstStore?.getSnapshot().ready === true,
      "Offline explorer store did not become ready.",
    );

    const movedNode = await firstStore.moveContainer(
      "child-container",
      "parent-b",
    );
    if (!movedNode) {
      throw new Error("Expected offline synced container move to be queued.");
    }
    expect(movedNode.parentId).toBe("parent-b");

    const pendingMoveIntentsBeforeRestart =
      await defaultExplorerPersistence.listPendingMoveIntents(
        runtime.infra.execSql,
      );
    expect(pendingMoveIntentsBeforeRestart).toEqual([
      expect.objectContaining({
        containerId: "child-container",
        parentContainerId: "parent-b",
        previousParentContainerId: "parent-a",
        syncStatus: "pending",
      }),
    ]);

    firstStore.updateRuntime(
      runtimeWithPatch(offlineRuntime, { dbStatus: "terminated" }),
    );
    firstStore = null;

    runtime = runtimeWithPatch(runtime, {
      apiClient: createMockApiClient({
        ...runtime.apiClient,
        ...harness.apiClient,
        listContainerParentLanes: createContainerParentLaneBatchMock(async () =>
          listContainersResponse(remoteContainers),
        ),
        moveContainer: async (containerId, request) => {
          const response = await harness.apiClient.moveContainer(
            containerId,
            request,
          );
          if (response) {
            remoteContainers = remoteContainers.map((container) =>
              container.id === containerId
                ? {
                    ...container,
                    metadataAccessEpoch: response.manifestHead.epoch,
                    metadataAccessStateHash: response.manifestHead.manifestHash,
                    metadataDocumentId: String(
                      Reflect.get(
                        response.accessManifest.state,
                        "metadataDocumentId",
                      ),
                    ),
                    parentId: response.parentId,
                  }
                : container,
            );
          }
          return response;
        },
      }),
      encapsulationKeyPair: localKeyPair,
      isAuthenticated: true,
      online: true,
      organizationId: "org-1",
      signingFingerprint,
      signingKeyPair,
      userId: "user-1",
    });

    secondStore = createExplorerStore(runtime);
    secondStore.updateRuntime(runtime);

    await waitForCondition(async () => {
      const pendingMoveIntents =
        await defaultExplorerPersistence.listPendingMoveIntents(
          runtime.infra.execSql,
        );
      return (
        harness.containerMoveCalls.length === 1 &&
        pendingMoveIntents.length === 0 &&
        secondStore
          ?.getSnapshot()
          .nodes.some(
            (node) =>
              node.id === "child-container" && node.parentId === "parent-b",
          ) === true
      );
    }, "Restarted explorer store did not replay the queued synced container move.");

    expect(harness.containerMoveCalls).toEqual([
      {
        containerId: "child-container",
        parentId: "parent-b",
        wrapRecipientKinds: ["container"],
      },
    ]);

    const persistedContainers = await loadContainers(runtime.infra.execSql);
    expect(
      persistedContainers.find(
        (container) => container.id === "child-container",
      )?.parentId,
    ).toBe("parent-b");
  } finally {
    if (firstStore) {
      firstStore.updateRuntime(
        runtimeWithPatch(runtime, { dbStatus: "terminated" }),
      );
    }
    if (secondStore) {
      secondStore.updateRuntime(
        runtimeWithPatch(runtime, { dbStatus: "terminated" }),
      );
    }
    runtime.close();
  }
});

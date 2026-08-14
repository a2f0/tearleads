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
  type ListedContainer,
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

test("explorer sync replays moved local containers from disk after restart and login", async () => {
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
  const harness = createExplorerContainerApiHarness([rootProjection]);
  let firstStore: ReturnType<typeof createExplorerStore> | null = null;
  let secondStore: ReturnType<typeof createExplorerStore> | null = null;

  try {
    await ensureContainerTables(runtime.infra.execSql);
    await ensureDocumentTables(runtime.infra.execSql);
    const { initialUpdate: rootInitialUpdate } =
      await createInitializedContainerMetadataDocument("root-container", {
        icon: null,
        name: "/",
      });
    await saveContainer(runtime.infra.execSql, {
      id: "root-container",
      organizationId: "org-1",
      parentId: null,
      metadataDocumentId: "root-metadata-document",
      name: "/",
      icon: null,
    });
    await saveDocumentRecord(
      runtime.infra.execSql,
      {
        appKind: "container-metadata",
        localId: "root-container",
      },
      {
        accessEpoch: 1,
        accessStateHash: "root-access-state-hash-1",
        documentId: "root-metadata-document",
        id: "root-container",
        lastCommitLsn: null,
        metadataUpdates: bytesToBase64(rootInitialUpdate),
        snapshotEndVersion: "",
      },
      new Date("2026-04-25T00:00:00.000Z").toISOString(),
    );

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

    const movedNode = await firstStore.createChild("root-container", "Moved");
    const targetA = await firstStore.createChild("root-container", "Target A");
    const targetB = await firstStore.createChild("root-container", "Target B");
    if (!movedNode || !targetA || !targetB) {
      throw new Error("Expected local container create chain.");
    }

    await firstStore.moveContainer(movedNode.id, targetA.id);
    await firstStore.moveContainer(movedNode.id, targetB.id);

    expect(
      firstStore.getSnapshot().nodes.find((node) => node.id === movedNode.id)
        ?.parentId,
    ).toBe(targetB.id);

    firstStore.updateRuntime(
      runtimeWithPatch(offlineRuntime, { dbStatus: "terminated" }),
    );
    firstStore = null;

    const persistedContainersBeforeLogin = await loadContainers(
      runtime.infra.execSql,
    );
    expect(
      persistedContainersBeforeLogin.find(
        (container) => container.id === movedNode.id,
      )?.parentId,
    ).toBe(targetB.id);
    const pendingCreateIntentsBeforeLogin =
      await defaultExplorerPersistence.listPendingCreateIntents(
        runtime.infra.execSql,
      );
    expect(pendingCreateIntentsBeforeLogin).toHaveLength(3);
    expect(pendingCreateIntentsBeforeLogin).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          containerId: movedNode.id,
          parentContainerId: targetB.id,
          syncStatus: "pending",
        }),
        expect.objectContaining({
          containerId: targetA.id,
          parentContainerId: "root-container",
          syncStatus: "pending",
        }),
        expect.objectContaining({
          containerId: targetB.id,
          parentContainerId: "root-container",
          syncStatus: "pending",
        }),
      ]),
    );

    runtime = runtimeWithPatch(runtime, {
      apiClient: createMockApiClient({
        ...runtime.apiClient,
        ...harness.apiClient,
        getUserIdentity: async (requestedUserId: string) => ({
          encapsulationKeyFingerprint: await toFingerprint(
            localKeyPair.publicKey,
          ),
          encapsulationPublicKey: bytesToBase64(localKeyPair.publicKey),
          signingKeyFingerprint: signingFingerprint,
          signingPublicKey: bytesToBase64(signingKeyPair.signingPublicKey),
          userId: requestedUserId,
        }),
        listContainerParentLanes: createContainerParentLaneBatchMock(
          async (options) =>
            options.parentId === null || options.parentId === undefined
              ? listContainersResponse([
                  listedContainer({
                    id: "root-container",
                    metadataAccessEpoch: 1,
                    metadataAccessStateHash: "root-access-state-hash-1",
                    metadataDocumentId: "root-metadata-document",
                    organizationId: "org-1",
                    parentId: null,
                  }),
                ])
              : listContainersResponse(),
        ),
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
      const pendingIntents =
        await defaultExplorerPersistence.listPendingCreateIntents(
          runtime.infra.execSql,
        );
      return (
        harness.containerCreateCalls.length === 3 &&
        harness.documentCreateCalls.length === 3 &&
        pendingIntents.length === 0
      );
    }, "Restarted explorer store did not replay moved local containers.");

    expect(harness.containerMoveCalls).toEqual([]);
    expect(harness.containerCreateCalls).toHaveLength(3);
    expect(harness.containerCreateCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          containerId: movedNode.id,
          parentId: targetB.id,
        }),
        expect.objectContaining({
          containerId: targetA.id,
          parentId: "root-container",
        }),
        expect.objectContaining({
          containerId: targetB.id,
          parentId: "root-container",
        }),
      ]),
    );

    const persistedContainersAfterLogin = await loadContainers(
      runtime.infra.execSql,
    );
    expect(
      persistedContainersAfterLogin.find(
        (container) => container.id === movedNode.id,
      )?.parentId,
    ).toBe(targetB.id);
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

test("explorer sync creates queued local containers parent before child", async () => {
  const runtime = await createSqlRuntime();
  const localKeyPair = generateKemSeedAndKeyPair();
  let store: ReturnType<typeof createExplorerStore> | null = null;

  try {
    await ensureContainerTables(runtime.infra.execSql);
    await ensureDocumentTables(runtime.infra.execSql);
    const { initialUpdate: rootInitialUpdate } =
      await createInitializedContainerMetadataDocument("root-container", {
        icon: null,
        name: "/",
      });
    await saveContainer(runtime.infra.execSql, {
      id: "root-container",
      organizationId: "org-1",
      parentId: null,
      metadataDocumentId: "root-metadata-document",
      name: "/",
      icon: null,
    });
    await saveDocumentRecord(
      runtime.infra.execSql,
      {
        appKind: "container-metadata",
        localId: "root-container",
      },
      {
        accessEpoch: 1,
        accessStateHash: "stale-root-access-state-hash",
        documentId: "root-metadata-document",
        id: "root-container",
        lastCommitLsn: null,
        metadataUpdates: bytesToBase64(rootInitialUpdate),
        snapshotEndVersion: "",
      },
      new Date("2026-04-25T00:00:00.000Z").toISOString(),
    );

    const createdStore = createExplorerStore(runtime);
    store = createdStore;
    createdStore.updateRuntime(runtime);

    await waitForCondition(
      () => createdStore.getSnapshot().ready,
      "Explorer store did not become ready.",
    );

    const parentNode = await createdStore.createChild(
      "root-container",
      "Parent",
    );
    const childNode = parentNode
      ? await createdStore.createChild(parentNode.id, "Child")
      : null;
    const grandchildNode = childNode
      ? await createdStore.createChild(childNode.id, "Grandchild")
      : null;
    if (!parentNode || !childNode || !grandchildNode) {
      throw new Error("Expected local container create chain.");
    }

    const signingKeyPair = generateSigningSeedAndKeyPair();
    const signingFingerprint = await toFingerprint(
      signingKeyPair.signingPublicKey,
    );
    const harness = createExplorerContainerApiHarness([
      await createExplorerMetadataContainerProjection({
        containerId: "root-container",
        encapsulationPublicKey: localKeyPair.publicKey,
        organizationId: "org-1",
        signerKeyFingerprint: signingFingerprint,
        signerPrivateKey: signingKeyPair.signingPrivateKey,
        userId: "user-1",
      }),
    ]);
    const remoteContainers = new Map<string, ListedContainer>([
      [
        "root-container",
        listedContainer({
          id: "root-container",
          metadataAccessEpoch: 2,
          metadataAccessStateHash: "current-root-access-state-hash",
          metadataDocumentId: "root-metadata-document",
          organizationId: "org-1",
          parentId: null,
        }),
      ],
    ]);
    const authenticatedRuntime = runtimeWithPatch(runtime, {
      apiClient: createMockApiClient({
        ...runtime.apiClient,
        ...harness.apiClient,
        getUserIdentity: async (requestedUserId: string) => ({
          encapsulationKeyFingerprint: await toFingerprint(
            localKeyPair.publicKey,
          ),
          encapsulationPublicKey: bytesToBase64(localKeyPair.publicKey),
          signingKeyFingerprint: signingFingerprint,
          signingPublicKey: bytesToBase64(signingKeyPair.signingPublicKey),
          userId: requestedUserId,
        }),
        listContainerParentLanes: createContainerParentLaneBatchMock(async () =>
          listContainersResponse(Array.from(remoteContainers.values())),
        ),
      }),
      encapsulationKeyPair: localKeyPair,
      isAuthenticated: true,
      online: true,
      organizationId: "org-1",
      signingFingerprint,
      signingKeyPair,
      userId: "user-1",
    });

    createdStore.updateRuntime(authenticatedRuntime);

    await waitForCondition(
      async () =>
        harness.containerCreateCalls.length === 3 &&
        harness.documentCreateCalls.length === 3 &&
        (
          await defaultExplorerPersistence.listPendingCreateIntents(
            runtime.infra.execSql,
          )
        ).length === 0,
      `Queued local containers were not synced.\ncreateContainerCalls=${JSON.stringify(
        harness.containerCreateCalls,
      )}`,
    );

    expect(harness.containerCreateCalls).toEqual([
      {
        containerId: parentNode.id,
        metadataDocumentId: parentNode.id,
        parentId: "root-container",
        wrapRecipientKinds: ["container"],
      },
      {
        containerId: childNode.id,
        metadataDocumentId: childNode.id,
        parentId: parentNode.id,
        wrapRecipientKinds: ["container"],
      },
      {
        containerId: grandchildNode.id,
        metadataDocumentId: grandchildNode.id,
        parentId: childNode.id,
        wrapRecipientKinds: ["container"],
      },
    ]);
    expect(harness.documentCreateCalls).toEqual([
      {
        containerId: parentNode.id,
        documentId: parentNode.id,
      },
      {
        containerId: childNode.id,
        documentId: childNode.id,
      },
      {
        containerId: grandchildNode.id,
        documentId: grandchildNode.id,
      },
    ]);
    expect(
      await defaultExplorerPersistence.listPendingCreateIntents(
        runtime.infra.execSql,
      ),
    ).toEqual([]);

    const persistedContainers = await loadContainers(runtime.infra.execSql);
    expect(
      persistedContainers.find((container) => container.id === parentNode.id)
        ?.metadataDocumentId,
    ).toBe(parentNode.id);
    expect(
      persistedContainers.find((container) => container.id === childNode.id)
        ?.metadataDocumentId,
    ).toBe(childNode.id);
    expect(
      persistedContainers.find(
        (container) => container.id === grandchildNode.id,
      )?.metadataDocumentId,
    ).toBe(grandchildNode.id);
  } finally {
    if (store) {
      store.updateRuntime(
        runtimeWithPatch(runtime, { dbStatus: "terminated" }),
      );
    }
    runtime.close();
  }
});

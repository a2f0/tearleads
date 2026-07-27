import { expect, test } from "bun:test";
import {
  createContainerDocumentObjectSyncState,
  createContainerContentsDocumentsRuntime as createExplorerDocumentsRuntime,
  createContainerContentsStore as createExplorerStore,
  createInitializedContainerMetadataDocument,
  defaultDocumentsPersistence,
  defaultContainerContentsPersistence as defaultExplorerPersistence,
  openDocumentStore,
  waitForDomainSyncCoordinatorToSettle,
} from "@tearleads/client-sdk";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  createContainerParentLaneBatchMock as batchParentLanes,
  createMockApiClient,
} from "@tearleads/test-utils";
import {
  createExplorerMetadataContainerProjection,
  ensureContainerTables,
  ensureDocumentTables,
  listContainersResponse,
  listedContainer,
  loadContainers,
  readSqlRowValue,
  saveContainer,
  saveDocumentRecord,
} from "../../../test/helpers/explorer-provider/explorerProviderFixtures";
import {
  createExplorerContainerApiHarness,
  createSqlRuntime,
  runtimeWithPatch,
} from "../../../test/helpers/explorer-provider/explorerProviderHarness";
import { waitForCondition } from "../../../test/helpers/waitForCondition";

test("explorer store flushes an offline child-container write after network reconnect", async () => {
  let runtime = await createSqlRuntime();
  const localKeyPair = generateKemSeedAndKeyPair();
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
    }),
    encapsulationKeyPair: localKeyPair,
    isAuthenticated: true,
    online: false,
    organizationId: "org-1",
    signingFingerprint,
    signingKeyPair,
    userId: "user-1",
  });
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

    const store = createExplorerStore(runtime);
    store.updateRuntime(runtime);

    await waitForCondition(
      () => store.getSnapshot().ready,
      "Explorer store did not become ready.",
    );

    const childNode = await store.createChild("root-container", "Docs");
    if (!childNode) {
      throw new Error("Expected createChild to return a new container node.");
    }

    await waitForCondition(async () => {
      const pendingIntents =
        await defaultExplorerPersistence.listPendingCreateIntents(
          runtime.infra.execSql,
        );
      return pendingIntents.some(
        (intent) => intent.containerId === childNode.id,
      );
    }, "Offline child container create was not persisted.");
    expect(harness.containerCreateCalls).toEqual([]);
    expect(
      await waitForDomainSyncCoordinatorToSettle(runtime.state.domainScope, {
        quietMs: 0,
        timeoutMs: 1_000,
      }),
    ).toBe(true);

    runtime = runtimeWithPatch(runtime, { online: true });
    store.updateRuntime(runtime);

    await waitForCondition(async () => {
      const pendingRows = await runtime.infra.execSql(
        `
 SELECT COUNT(*) AS count
 FROM document_pending_updates
 WHERE app_kind = 'container-metadata'
 AND local_id = :containerId
 `,
        {
          ":containerId": childNode.id,
        },
      );
      return (
        harness.containerCreateCalls.length === 1 &&
        Number(readSqlRowValue(pendingRows[0] ?? {}, "count")) === 0
      );
    }, "Created child metadata update was not synced after network reconnect.");
    expect(
      await defaultExplorerPersistence.listPendingCreateIntents(
        runtime.infra.execSql,
      ),
    ).toEqual([]);

    expect(harness.containerCreateCalls).toEqual([
      {
        containerId: childNode.id,
        metadataDocumentId: childNode.id,
        parentId: "root-container",
        wrapRecipientKinds: ["container"],
      },
    ]);
    expect(harness.documentCreateCalls).toEqual([
      {
        containerId: childNode.id,
        documentId: childNode.id,
      },
    ]);
    expect(harness.containerMetadataCreateCalls).toEqual([
      {
        containerId: childNode.id,
        metadataDocumentId: childNode.id,
      },
    ]);
    expect(harness.documentSyncCalls).toEqual([
      {
        documentId: childNode.id,
        outgoingUpdateCount: 1,
      },
    ]);
    const persistedContainers = await loadContainers(runtime.infra.execSql);
    const persistedChild = persistedContainers.find(
      (container) => container.id === childNode.id,
    );
    expect(persistedChild?.metadataDocumentId).toBe(childNode.id);
    expect(
      store.getSnapshot().nodes.find((node) => node.id === childNode.id)
        ?.syncState,
    ).toEqual(createContainerDocumentObjectSyncState({}));
  } finally {
    runtime.close();
  }
});

test("explorer store can skip background system container creation after managed root policy advances", async () => {
  let runtime = await createSqlRuntime();
  const systemSlot = "sys_v1_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  let listContainersCalls = 0;
  let writerProjectionCalls = 0;
  let systemContainerCreateCalls = 0;

  runtime = runtimeWithPatch(runtime, {
    apiClient: createMockApiClient({
      ...runtime.apiClient,
      createContainerWithMetadataDocument: async () => {
        systemContainerCreateCalls += 1;
        return null;
      },
      getContainerWriterProjection: async () => {
        writerProjectionCalls += 1;
        return null;
      },
      listContainerParentLanes: batchParentLanes(async () => {
        listContainersCalls += 1;
        return listContainersResponse([
          listedContainer({
            id: "root-container",
            metadataAccessEpoch: 1,
            metadataAccessStateHash: "root-access-state",
            metadataDocumentId: "root-metadata-document",
            metadataReferencedPrincipals: [
              {
                keyEpoch: 1,
                keyFingerprint: "group-key",
                principalId: "admins-group",
                principalType: "group",
                stateHash: "advanced-state",
                version: 2,
              },
            ],
            organizationId: "org-1",
            parentId: null,
          }),
        ]);
      }),
    }),
    isAuthenticated: true,
    online: true,
    organizationId: "org-1",
    state: { ...runtime.state, containerId: "root-container" },
    userId: "user-1",
  });

  try {
    await ensureContainerTables(runtime.infra.execSql);
    await ensureDocumentTables(runtime.infra.execSql);
    await saveContainer(runtime.infra.execSql, {
      id: "root-container",
      organizationId: "org-1",
      parentId: null,
      metadataDocumentId: null,
      name: "/",
      icon: null,
    });

    const store = createExplorerStore(runtime);
    store.updateRuntime(runtime);
    await waitForCondition(
      () => store.getSnapshot().ready,
      "Explorer store did not become ready.",
    );

    await expect(
      store.ensureSystemContainer(systemSlot, "Contacts", {
        skipAdvancedManagedRoot: true,
      }),
    ).resolves.toBeNull();
    expect(listContainersCalls).toBeGreaterThan(0);
    expect(writerProjectionCalls).toBe(0);
    expect(systemContainerCreateCalls).toBe(0);
  } finally {
    runtime.close();
  }
});

test("explorer store queues authenticated child create when parent has no remote access state", async () => {
  let runtime = await createSqlRuntime();
  const localKeyPair = generateKemSeedAndKeyPair();
  let store: ReturnType<typeof createExplorerStore> | null = null;

  runtime = runtimeWithPatch(runtime, {
    apiClient: createMockApiClient({
      ...runtime.apiClient,
    }),
    encapsulationKeyPair: localKeyPair,
    isAuthenticated: true,
    online: true,
  });

  try {
    await ensureContainerTables(runtime.infra.execSql);
    await ensureDocumentTables(runtime.infra.execSql);
    await saveContainer(runtime.infra.execSql, {
      id: "root-container",
      organizationId: "org-1",
      parentId: null,
      metadataDocumentId: null,
      name: "/",
      icon: null,
    });

    const createdStore = createExplorerStore(runtime);
    store = createdStore;
    createdStore.updateRuntime(runtime);

    await waitForCondition(
      () => createdStore.getSnapshot().ready,
      "Explorer store did not become ready.",
    );

    const childNode = await createdStore.createChild("root-container", "Docs");
    if (!childNode) {
      throw new Error("Expected createChild to queue a local container.");
    }

    expect(childNode.parentId).toBe("root-container");
    expect(childNode.name).toBe("Docs");

    const pendingIntents =
      await defaultExplorerPersistence.listPendingCreateIntents(
        runtime.infra.execSql,
      );
    expect(pendingIntents).toEqual([
      expect.objectContaining({
        containerId: childNode.id,
        parentContainerId: "root-container",
        syncStatus: "pending",
      }),
    ]);

    const pendingUpdateRows = await runtime.infra.execSql(
      `
 SELECT COUNT(*) AS count
 FROM document_pending_updates
 WHERE app_kind = 'container-metadata'
 AND local_id = :containerId
 `,
      {
        ":containerId": childNode.id,
      },
    );
    expect(Number(readSqlRowValue(pendingUpdateRows[0] ?? {}, "count"))).toBe(
      1,
    );
  } finally {
    if (store) {
      store.updateRuntime(
        runtimeWithPatch(runtime, { dbStatus: "terminated" }),
      );
    }
    runtime.close();
  }
});

test("explorer sync primes local document stores after login", async () => {
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
  let store: ReturnType<typeof createExplorerStore> | null = null;

  try {
    await ensureContainerTables(runtime.infra.execSql);
    await ensureDocumentTables(runtime.infra.execSql);
    await saveContainer(runtime.infra.execSql, {
      id: "root-container",
      organizationId: "org-1",
      parentId: null,
      metadataDocumentId: "root-metadata-document",
      name: "/",
      icon: null,
    });

    const offlineRuntime = runtimeWithPatch(runtime, {
      isAuthenticated: false,
      online: false,
    });
    const importedDocumentStore = openDocumentStore(
      offlineRuntime.state.domainScope,
      "uploaded-text-note",
      createExplorerDocumentsRuntime(offlineRuntime, "root-container"),
      null,
      "Uploaded text",
    );
    await importedDocumentStore.ensureInitialized();

    store = createExplorerStore(offlineRuntime);
    store.updateRuntime(offlineRuntime);

    await waitForCondition(
      () => store?.getSnapshot().ready === true,
      "Offline explorer store did not become ready.",
    );
    expect(importedDocumentStore.getSnapshot().documentId).toBeNull();

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
        listContainerParentLanes: batchParentLanes(async (options) =>
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

    store.updateRuntime(runtime);
    await waitForCondition(
      () => store?.getSnapshot().ready === true,
      "Online explorer store did not become ready.",
    );

    await waitForCondition(
      () =>
        importedDocumentStore.getSnapshot().documentId !== null &&
        !importedDocumentStore.getSnapshot().syncing,
      "Imported local document did not sync after Explorer login.",
    );

    const documentId = importedDocumentStore.getSnapshot().documentId;
    const persistedDocument = await defaultDocumentsPersistence.loadDocument(
      runtime.infra.execSql,
      "uploaded-text-note",
    );
    expect(documentId).toBeString();
    expect(persistedDocument?.documentId).toBe(documentId);
    expect(harness.documentCreateCalls).toEqual([
      expect.objectContaining({
        containerId: "root-container",
        documentId,
      }),
    ]);
    expect(harness.documentSyncCalls).toEqual([
      expect.objectContaining({
        documentId,
        outgoingUpdateCount: 1,
      }),
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

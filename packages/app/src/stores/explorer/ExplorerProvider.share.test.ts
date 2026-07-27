import { expect, test } from "bun:test";
import {
  createContainerDocumentObjectSyncState,
  createContainerParentSyncLane as createExplorerContainerParentSyncLane,
  createContainerContentsStore as createExplorerStore,
  createInitializedContainerMetadataDocument,
  loadContainerSyncWatermark as loadExplorerContainerSyncWatermark,
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
  readSqlRowValue,
  saveContainer,
  saveDocumentRecord,
} from "../../../test/helpers/explorer-provider/explorerProviderFixtures";
import {
  createExplorerContainerApiHarness,
  createExplorerMetadataFixture,
  createSqlRuntime,
  runtimeWithPatch,
} from "../../../test/helpers/explorer-provider/explorerProviderHarness";
import { waitForCondition } from "../../../test/helpers/waitForCondition";

test("explorer store shares an authenticated container without reseeding metadata envelopes", async () => {
  let runtime = await createSqlRuntime();
  const localKeyPair = generateKemSeedAndKeyPair();
  const peerKeyPair = generateKemSeedAndKeyPair();
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const signingFingerprint = await toFingerprint(
    signingKeyPair.signingPublicKey,
  );
  const containerProjection = await createExplorerMetadataContainerProjection({
    containerId: "child-container",
    encapsulationPublicKey: localKeyPair.publicKey,
    organizationId: "org-1",
    signerKeyFingerprint: signingFingerprint,
    signerPrivateKey: signingKeyPair.signingPrivateKey,
    userId: "user-1",
  });
  const harness = createExplorerContainerApiHarness([containerProjection]);
  let writerProjectionCallCount = 0;
  let syncCallCount = 0;

  runtime = runtimeWithPatch(runtime, {
    apiClient: createMockApiClient({
      ...runtime.apiClient,
      ...harness.apiClient,
      getUserIdentity: async (requestedUserId: string) => {
        if (requestedUserId !== "550e8400-e29b-41d4-a716-446655440000") {
          return null;
        }

        return {
          encapsulationKeyFingerprint: await toFingerprint(
            peerKeyPair.publicKey,
          ),
          encapsulationPublicKey: bytesToBase64(peerKeyPair.publicKey),
          signingKeyFingerprint: signingFingerprint,
          signingPublicKey: bytesToBase64(signingKeyPair.signingPublicKey),
          userId: requestedUserId,
        };
      },
      getDocumentWriterProjection: async () => {
        writerProjectionCallCount += 1;
        return null;
      },
      listContainerParentLanes: createContainerParentLaneBatchMock(async () =>
        listContainersResponse(),
      ),
      syncDocument: async () => {
        syncCallCount += 1;
        return null;
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
  let store: ReturnType<typeof createExplorerStore> | null = null;

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
    await saveContainer(runtime.infra.execSql, {
      id: "child-container",
      organizationId: "org-1",
      parentId: "root-container",
      metadataDocumentId: "metadata-document-1",
      name: "Docs",
      icon: null,
    });
    const { initialUpdate } = await createInitializedContainerMetadataDocument(
      "child-container",
      {
        icon: null,
        name: "Docs",
      },
    );
    await saveDocumentRecord(
      runtime.infra.execSql,
      {
        appKind: "container-metadata",
        localId: "child-container",
      },
      {
        accessEpoch: 1,
        accessStateHash: "access-state-hash-1",
        documentId: "metadata-document-1",
        id: "child-container",
        metadataUpdates: bytesToBase64(initialUpdate),
        snapshotEndVersion: "",
        contentKeyBundle: "stale-content-key-bundle",
        documentKekTargets: "stale-kek-targets",
        documentManifestBundle: "stale-manifest-bundle",
      },
      new Date("2026-04-09T12:00:00.000Z").toISOString(),
    );

    const createdStore = createExplorerStore(runtime);
    store = createdStore;
    createdStore.updateRuntime(runtime);

    await waitForCondition(
      () => createdStore.getSnapshot().ready,
      "Explorer store did not become ready.",
    );

    writerProjectionCallCount = 0;
    syncCallCount = 0;
    const shared = await createdStore.shareWithUser(
      "child-container",
      "550e8400-e29b-41d4-a716-446655440000",
    );

    expect(shared).toBe(true);

    await waitForCondition(async () => {
      const rows = await runtime.infra.execSql(
        `
 SELECT
 content_key_bundle,
 document_kek_targets,
 document_manifest_bundle
 FROM documents
 WHERE app_kind = 'container-metadata'
 AND local_id = 'child-container'
 `,
      );
      return (
        writerProjectionCallCount > 0 &&
        readSqlRowValue(rows[0] ?? {}, "content_key_bundle") === null &&
        readSqlRowValue(rows[0] ?? {}, "document_kek_targets") === null &&
        readSqlRowValue(rows[0] ?? {}, "document_manifest_bundle") === null
      );
    }, "Explorer store did not clear stale metadata security state after share.");

    expect(syncCallCount).toBe(0);
    expect(
      createdStore
        .getSnapshot()
        .nodes.some(
          (node) =>
            node.id === "child-container" && node.organizationId === "org-1",
        ),
    ).toBe(true);

    expect(harness.containerShareCalls).toEqual([
      {
        accessLevel: "write",
        containerId: "child-container",
        subjectId: "550e8400-e29b-41d4-a716-446655440000",
        wrapRecipientKinds: ["user", "user"],
      },
    ]);
  } finally {
    if (store) {
      store.updateRuntime(
        runtimeWithPatch(runtime, { dbStatus: "terminated" }),
      );
    }
    runtime.close();
  }
}, 20_000);

test("explorer store persists commitLsn and reuses it as minLsn on the next metadata sync", async () => {
  let runtime = await createSqlRuntime();
  const localKeyPair = generateKemSeedAndKeyPair();
  const syncCalls: Array<{
    minLsn: string | null;
    outgoingUpdateCount: number;
  }> = [];
  let store: ReturnType<typeof createExplorerStore> | null = null;
  const fixture = await createExplorerMetadataFixture({
    containerId: "child-container",
    documentId: "metadata-document-1",
    encapsulationKeyPair: localKeyPair,
    execSql: runtime.infra.execSql,
    syncCalls,
  });

  runtime = runtimeWithPatch(runtime, {
    apiClient: createMockApiClient({
      ...runtime.apiClient,
      ...fixture.apiClient,
      listContainerParentLanes: createContainerParentLaneBatchMock(async () =>
        listContainersResponse(),
      ),
    }),
    encapsulationKeyPair: localKeyPair,
    isAuthenticated: true,
    online: true,
    organizationId: fixture.organizationId,
    signingFingerprint: fixture.signingFingerprint,
    signingKeyPair: fixture.signingKeyPair,
    userId: fixture.userId,
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
    await saveContainer(runtime.infra.execSql, {
      id: "child-container",
      organizationId: "org-1",
      parentId: "root-container",
      metadataDocumentId: "metadata-document-1",
      name: "Docs",
      icon: null,
    });
    const { initialUpdate } = await createInitializedContainerMetadataDocument(
      "child-container",
      {
        icon: null,
        name: "Docs",
      },
    );
    await saveDocumentRecord(
      runtime.infra.execSql,
      {
        appKind: "container-metadata",
        localId: "child-container",
      },
      {
        ...fixture.persistedState,
        accessEpoch: 1,
        accessStateHash: "metadata-access-state-hash-1",
        documentId: "metadata-document-1",
        id: "child-container",
        lastCommitLsn: null,
        metadataUpdates: bytesToBase64(initialUpdate),
        snapshotEndVersion: "",
      },
      new Date("2026-04-09T12:00:00.000Z").toISOString(),
    );

    const createdStore = createExplorerStore(runtime);
    store = createdStore;
    createdStore.updateRuntime(runtime);

    await waitForCondition(
      () => createdStore.getSnapshot().ready,
      "Explorer store did not become ready.",
    );
    await expect(createdStore.refresh()).resolves.toBe(true);

    await waitForCondition(
      () => syncCalls.some((call) => call.minLsn === null),
      "Initial metadata sync did not complete.",
    );

    await createdStore.renameContainer("child-container", "Docs updated");

    await waitForCondition(async () => {
      const pendingRows = await runtime.infra.execSql(
        `
 SELECT COUNT(*) AS count
 FROM document_pending_updates
 WHERE app_kind = 'container-metadata'
 AND local_id = 'child-container'
 `,
      );
      const pendingCount = Number(
        readSqlRowValue(pendingRows[0] ?? {}, "count") ?? 0,
      );

      return (
        syncCalls.some(
          (call) => call.minLsn === "0/10" && call.outgoingUpdateCount === 1,
        ) && pendingCount === 0
      );
    }, "Follow-up metadata sync did not complete.");

    const documentRows = await runtime.infra.execSql(
      `
 SELECT
 last_commit_lsn,
 content_key_bundle,
 document_kek_targets,
 document_manifest_bundle
 FROM documents
 WHERE app_kind = 'container-metadata'
 AND local_id = 'child-container'
 `,
    );
    expect(syncCalls.some((call) => call.minLsn === null)).toBe(true);
    expect(syncCalls.some((call) => call.minLsn === "0/10")).toBe(true);
    expect(readSqlRowValue(documentRows[0] ?? {}, "last_commit_lsn")).toBe(
      "0/20",
    );
    expect(
      readSqlRowValue(documentRows[0] ?? {}, "content_key_bundle"),
    ).toBeString();
    expect(
      readSqlRowValue(documentRows[0] ?? {}, "document_kek_targets"),
    ).toBeString();
    expect(
      readSqlRowValue(documentRows[0] ?? {}, "document_manifest_bundle"),
    ).toBeString();
  } finally {
    if (store) {
      store.updateRuntime(
        runtimeWithPatch(runtime, { dbStatus: "terminated" }),
      );
    }
    runtime.close();
  }
});

test("explorer store refreshes remote containers on demand after initialization", async () => {
  let runtime = await createSqlRuntime();
  const localKeyPair = generateKemSeedAndKeyPair();
  let listContainersCalls = 0;
  const listContainersOptions: Array<{ parentId?: string | null }> = [];

  runtime = runtimeWithPatch(runtime, {
    apiClient: createMockApiClient({
      ...runtime.apiClient,
      listContainerParentLanes: createContainerParentLaneBatchMock(
        async (options) => {
          listContainersCalls += 1;
          listContainersOptions.push(options);

          if (listContainersCalls === 1) {
            return listContainersResponse();
          }

          if (options.parentId === null || options.parentId === undefined) {
            return {
              hasMore: false,
              items: [
                listedContainer({
                  id: "shared-root-container",
                  metadataAccessEpoch: 1,
                  metadataAccessStateHash: "shared-root-access-state-hash-1",
                  metadataDocumentId: "shared-root-metadata-document",
                  organizationId: "org-2",
                  parentId: null,
                }),
              ],
              nextWatermark: {
                id: "shared-root-container",
                updatedAt: "2026-05-05T00:00:00.000Z",
              },
              tombstones: [],
            };
          }

          return listContainersResponse(
            options.parentId === "shared-root-container"
              ? [
                  listedContainer({
                    id: "shared-child-container",
                    metadataAccessEpoch: 1,
                    metadataAccessStateHash: "shared-child-access-state-hash-1",
                    metadataDocumentId: "shared-child-metadata-document",
                    organizationId: "org-2",
                    parentId: "shared-root-container",
                  }),
                ]
              : [],
          );
        },
      ),
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

    expect(createdStore.getSnapshot().nodes).toEqual([]);

    const refreshed = await createdStore.refresh();

    expect(refreshed).toBe(true);

    await waitForCondition(
      () =>
        createdStore
          .getSnapshot()
          .nodes.some((node) => node.id === "shared-root-container"),
      "Explorer refresh did not hydrate shared remote root.",
    );
    await waitForCondition(
      () =>
        createdStore
          .getSnapshot()
          .nodes.some(
            (node) =>
              node.id === "shared-child-container" &&
              node.parentId === "shared-root-container",
          ),
      "Explorer refresh did not hydrate shared remote child container.",
    );
    const refreshedNodes = createdStore.getSnapshot().nodes;
    expect(
      refreshedNodes.find((node) => node.id === "shared-root-container")
        ?.syncState,
    ).toEqual(createContainerDocumentObjectSyncState({}));
    expect(
      refreshedNodes.find((node) => node.id === "shared-child-container")
        ?.syncState,
    ).toEqual(createContainerDocumentObjectSyncState({}));

    expect(listContainersCalls).toBeGreaterThanOrEqual(2);
    expect(
      listContainersOptions.every((options) => !("depth" in options)),
    ).toBe(true);
    expect(
      listContainersOptions.some((options) => options.parentId === null),
    ).toBe(true);
    expect(
      listContainersOptions.some(
        (options) => options.parentId === "shared-root-container",
      ),
    ).toBe(true);
    await expect(
      loadExplorerContainerSyncWatermark(
        runtime.infra.execSql,
        createExplorerContainerParentSyncLane(null),
      ),
    ).resolves.toEqual({
      id: "shared-root-container",
      updatedAt: "2026-05-05T00:00:00.000Z",
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

import { expect, test } from "bun:test";
import {
  type ContainerState,
  createContainerDocumentObjectSyncState,
  createContainerContentsStoreState as createExplorerStoreState,
  createContainerContentsStoreSyncAgent as createExplorerSyncAgent,
  createInitializedContainerMetadataDocument,
  defaultContainerContentsPersistence as defaultExplorerPersistence,
  subscribeToContainerContentsStore as subscribeToExplorerStore,
  updateContainerContentsSnapshot as updateExplorerSnapshot,
} from "@symcrypt/client-sdk";
import {
  generateKemSeedAndKeyPair,
  KeyingVerificationError,
} from "@symcrypt/crypto";
import { createMockApiClient } from "@symcrypt/test-utils";
import {
  listedContainer,
  loadContainers,
  TEST_SYNC_TIMESTAMP,
} from "../../../test/helpers/explorer-provider/explorerProviderFixtures";
import {
  createSqlRuntime,
  runtimeWithPatch,
} from "../../../test/helpers/explorer-provider/explorerProviderHarness";
import { waitForCondition } from "../../../test/helpers/waitForCondition";

test("explorer snapshot update skips notifications when node contents are unchanged", async () => {
  const runtime = await createSqlRuntime();

  try {
    const state = createExplorerStoreState(runtime, defaultExplorerPersistence);
    const { doc } = await createInitializedContainerMetadataDocument(
      "root-container",
      {
        icon: null,
        name: "/",
      },
    );
    state.containersById.set("root-container", {
      container: {
        id: "root-container",
        organizationId: "org-1",
        parentId: null,
        metadataDocumentId: null,
        name: "/",
        icon: null,
      },
      doc,
      record: {
        id: "root-container",
        documentId: null,
        metadataUpdates: "",
        snapshotEndVersion: "",
        accessEpoch: 1,
      },
    });

    let notificationCount = 0;
    const unsubscribe = subscribeToExplorerStore(state, () => {
      notificationCount += 1;
    });

    updateExplorerSnapshot(state);
    expect(notificationCount).toBe(1);

    const readySnapshot = state.snapshot;
    updateExplorerSnapshot(state);
    expect(notificationCount).toBe(1);
    expect(state.snapshot).toBe(readySnapshot);

    unsubscribe();
  } finally {
    runtime.close();
  }
});

test("explorer snapshot update emits when only node sync state changes", async () => {
  const runtime = await createSqlRuntime();

  try {
    const state = createExplorerStoreState(runtime, defaultExplorerPersistence);
    const { doc } = await createInitializedContainerMetadataDocument(
      "root-container",
      {
        icon: null,
        name: "/",
      },
    );
    const timestamp = "2026-05-05T00:00:00.000Z";
    const containerState: ContainerState = {
      container: {
        createdAt: timestamp,
        id: "root-container",
        organizationId: "org-1",
        parentId: null,
        metadataDocumentId: "root-metadata-document",
        name: "/",
        icon: null,
        localCreatedAt: timestamp,
        localUpdatedAt: timestamp,
        serverCreatedAt: timestamp,
        serverUpdatedAt: timestamp,
        updatedAt: timestamp,
      },
      doc,
      record: {
        id: "root-container",
        documentId: null,
        metadataUpdates: "",
        snapshotEndVersion: "",
        accessEpoch: 1,
      },
    };
    state.containersById.set("root-container", containerState);

    let notificationCount = 0;
    const unsubscribe = subscribeToExplorerStore(state, () => {
      notificationCount += 1;
    });

    updateExplorerSnapshot(state);
    expect(notificationCount).toBe(1);
    expect(state.snapshot.nodes[0]?.syncState).toEqual(
      createContainerDocumentObjectSyncState({ localOnly: true }),
    );

    containerState.record.documentId = "root-metadata-document";
    updateExplorerSnapshot(state);

    expect(notificationCount).toBe(2);
    expect(state.snapshot.nodes[0]?.syncState).toEqual(
      createContainerDocumentObjectSyncState({}),
    );

    unsubscribe();
  } finally {
    runtime.close();
  }
});

test("explorer sync agent batches concurrent remote ingests into one snapshot update", async () => {
  let snapshotUpdateCount = 0;
  const requestedPrincipalPolicies: string[] = [];
  const runtime = runtimeWithPatch(await createSqlRuntime(), {
    apiClient: createMockApiClient({
      getCurrentPrincipalPolicy: async (principalType, principalId) => {
        requestedPrincipalPolicies.push(`${principalType}:${principalId}`);
        return null;
      },
    }),
    organizationId: "org-1",
  });

  try {
    await defaultExplorerPersistence.ensureSchema(runtime.infra.execSql);

    const state = createExplorerStoreState(runtime, defaultExplorerPersistence);
    state.documentStoresNeedPriming = false;
    state.snapshot = { ...state.snapshot, ready: true };
    const syncAgent = createExplorerSyncAgent({
      host: {
        persistContainerState: async (
          containerState,
          _patch,
          _updateView,
          saveOptions,
        ) => {
          await defaultExplorerPersistence.saveContainer(
            runtime.infra.execSql,
            containerState.container,
            containerState.record,
            saveOptions,
          );
          return { record: containerState.record, status: "persisted" };
        },
        updateSnapshot: () => {
          snapshotUpdateCount += 1;
        },
      },
      state,
    });

    await Promise.all([
      syncAgent.ingestRemoteContainer(
        listedContainer({
          id: "container-a",
          metadataAccessEpoch: 1,
          metadataAccessStateHash: "container-a-access-state-hash-1",
          metadataDocumentId: "metadata-document-a",
          metadataReferencedPrincipals: [
            {
              keyEpoch: 1,
              keyFingerprint: "key-fingerprint-a",
              principalId: "group-a",
              principalType: "group",
              stateHash: "state-hash-a",
              version: 1,
            },
          ],
          organizationId: "org-1",
          parentId: null,
        }),
      ),
      syncAgent.ingestRemoteContainer(
        listedContainer({
          id: "container-b",
          metadataAccessEpoch: 1,
          metadataAccessStateHash: "container-b-access-state-hash-1",
          metadataDocumentId: "metadata-document-b",
          metadataReferencedPrincipals: [
            {
              keyEpoch: 1,
              keyFingerprint: "key-fingerprint-b",
              principalId: "group-b",
              principalType: "group",
              stateHash: "state-hash-b",
              version: 1,
            },
          ],
          organizationId: "org-1",
          parentId: "container-a",
        }),
      ),
    ]);

    expect(snapshotUpdateCount).toBe(1);
    expect(state.containersById.size).toBe(2);
    expect(requestedPrincipalPolicies).toEqual([
      "group:group-a",
      "group:group-b",
    ]);
    await expect(loadContainers(runtime.infra.execSql)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "container-a",
          localUpdatedAt: TEST_SYNC_TIMESTAMP,
          serverUpdatedAt: TEST_SYNC_TIMESTAMP,
        }),
        expect.objectContaining({
          id: "container-b",
          localUpdatedAt: TEST_SYNC_TIMESTAMP,
          serverUpdatedAt: TEST_SYNC_TIMESTAMP,
        }),
      ]),
    );
  } finally {
    runtime.close();
  }
});

test("explorer sync agent retries remote ingests after a failed batch", async () => {
  let snapshotUpdateCount = 0;
  const requestedPrincipalPolicies: string[] = [];
  const runtime = runtimeWithPatch(await createSqlRuntime(), {
    apiClient: createMockApiClient({
      getCurrentPrincipalPolicy: async (principalType, principalId) => {
        requestedPrincipalPolicies.push(`${principalType}:${principalId}`);
        if (requestedPrincipalPolicies.length === 1) {
          throw new KeyingVerificationError(
            "missing_dependency",
            "principal cache unavailable",
          );
        }
        return null;
      },
    }),
    organizationId: "org-1",
  });

  try {
    await defaultExplorerPersistence.ensureSchema(runtime.infra.execSql);

    const state = createExplorerStoreState(runtime, defaultExplorerPersistence);
    state.documentStoresNeedPriming = false;
    state.snapshot = { ...state.snapshot, ready: true };
    const syncAgent = createExplorerSyncAgent({
      host: {
        persistContainerState: async (
          containerState,
          _patch,
          _updateView,
          saveOptions,
        ) => {
          await defaultExplorerPersistence.saveContainer(
            runtime.infra.execSql,
            containerState.container,
            containerState.record,
            saveOptions,
          );
          return { record: containerState.record, status: "persisted" };
        },
        updateSnapshot: () => {
          snapshotUpdateCount += 1;
        },
      },
      state,
    });

    await expect(
      syncAgent.ingestRemoteContainer(
        listedContainer({
          id: "container-a",
          metadataAccessEpoch: 1,
          metadataAccessStateHash: "container-a-access-state-hash-1",
          metadataDocumentId: "metadata-document-a",
          metadataReferencedPrincipals: [
            {
              keyEpoch: 1,
              keyFingerprint: "key-fingerprint-a",
              principalId: "group-a",
              principalType: "group",
              stateHash: "state-hash-a",
              version: 1,
            },
          ],
          organizationId: "org-1",
          parentId: null,
        }),
      ),
    ).rejects.toThrow("principal cache unavailable");

    expect(snapshotUpdateCount).toBe(0);
    expect(state.containersById.size).toBe(0);

    await syncAgent.ingestRemoteContainer(
      listedContainer({
        id: "container-b",
        metadataAccessEpoch: 1,
        metadataAccessStateHash: "container-b-access-state-hash-1",
        metadataDocumentId: "metadata-document-b",
        metadataReferencedPrincipals: [
          {
            keyEpoch: 1,
            keyFingerprint: "key-fingerprint-b",
            principalId: "group-b",
            principalType: "group",
            stateHash: "state-hash-b",
            version: 1,
          },
        ],
        organizationId: "org-1",
        parentId: "container-a",
      }),
    );

    expect(snapshotUpdateCount).toBe(1);
    expect(Array.from(state.containersById.keys())).toEqual([
      "container-a",
      "container-b",
    ]);
    expect(requestedPrincipalPolicies).toEqual([
      "group:group-a",
      "group:group-a",
      "group:group-b",
    ]);
  } finally {
    runtime.close();
  }
});

test("explorer sync skips pending metadata updates for containers without document ids", async () => {
  const localKeyPair = generateKemSeedAndKeyPair();
  const runtime = runtimeWithPatch(await createSqlRuntime(), {
    encapsulationKeyPair: localKeyPair,
    isAuthenticated: true,
    online: true,
  });
  let listPendingCreateIntentCalls = 0;
  let listPendingUpdateCalls = 0;

  try {
    const persistence = {
      ...defaultExplorerPersistence,
      listPendingCreateIntents: async () => {
        listPendingCreateIntentCalls += 1;
        return [];
      },
      listUnsyncedMoveIntents: async () => [],
      listPendingUpdates: async () => {
        listPendingUpdateCalls += 1;
        return [];
      },
    };
    const { doc } = await createInitializedContainerMetadataDocument(
      "local-container",
      {
        icon: null,
        name: "Local",
      },
    );
    const state = createExplorerStoreState(runtime, persistence);
    state.containersById.set("local-container", {
      container: {
        id: "local-container",
        organizationId: "org-1",
        parentId: null,
        metadataDocumentId: null,
        name: "Local",
        icon: null,
      },
      doc,
      record: {
        accessEpoch: 1,
        accessStateHash: null,
        documentId: null,
        id: "local-container",
        lastCommitLsn: null,
        metadataUpdates: "",
        snapshotEndVersion: "",
        contentKeyBundle: null,
        documentKekTargets: null,
        documentManifestBundle: null,
      },
    });
    state.documentStoresNeedPriming = false;
    state.initialized = true;
    state.snapshot = { ...state.snapshot, ready: true };
    const syncAgent = createExplorerSyncAgent({
      host: {
        persistContainerState: async (containerState) => ({
          record: containerState.record,
          status: "persisted",
        }),
        updateSnapshot: () => undefined,
      },
      state,
    });

    syncAgent.scheduleSync();
    await waitForCondition(
      () => listPendingCreateIntentCalls > 0,
      "Explorer sync did not run.",
    );
    await Promise.resolve();

    expect(listPendingUpdateCalls).toBe(0);
  } finally {
    runtime.close();
  }
});

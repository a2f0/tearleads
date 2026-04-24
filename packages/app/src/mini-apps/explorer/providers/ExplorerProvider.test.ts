import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair, toFingerprint } from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import type { SyncDocumentResponse } from "@tearleads/loro";
import { createSqlRuntimeBase } from "../../../../test/helpers/createSqlRuntime";
import { waitForCondition } from "../../../../test/helpers/waitForCondition";
import {
  createInitializedContainerMetadataDocument,
  ensureContainerTables,
  loadContainers,
  saveContainer,
  sqlDocumentContainerProjectionPersistence,
} from "../../../data/containers";
import {
  createDocumentEncryptionMaterial,
  serializeDocumentRecipientEnvelopes,
} from "../../../data/documentSync";
import {
  ensureDocumentTables,
  saveDocumentRecord,
} from "../../../data/persistence/documentPersistence";
import { readSqlRowValue } from "../../../data/persistence/sqlSchema";
import { sqlNotesPersistence } from "../../notes/notesPersistence";
import { primeNotesStore } from "../../notes/providers/NotesProvider";
import { sqlExplorerPersistence } from "../explorerPersistence";
import { createExplorerStore } from "./ExplorerProvider";
import {
  createExplorerSyncAgent,
  type ExplorerSyncState,
} from "./explorerSyncAgent";

type ExplorerRuntime = Parameters<typeof createExplorerStore>[0];
type TestRuntime = ExplorerRuntime & { close: () => void };

function createSyncDocumentResponse(input: {
  accessEpoch: number;
  commitLsn?: string | null;
  documentId: string;
  recipientEncapsulationPublicKeys: string[];
  acceptedOutgoingUpdateIds?: string[];
  canonicalDocumentRecipientEnvelopesAdopted?: boolean;
  documentRecipientEnvelopeAction?: SyncDocumentResponse["documentRecipientEnvelopeAction"];
  documentRecipientEnvelopes?: SyncDocumentResponse["documentRecipientEnvelopes"];
  missingUpdateEpochs?: SyncDocumentResponse["missingUpdateEpochs"];
  rotateBaselineSourceVersionVector?: string | null;
  updates?: SyncDocumentResponse["updates"];
}): SyncDocumentResponse {
  return {
    acceptedOutgoingUpdateIds: input.acceptedOutgoingUpdateIds ?? [],
    canonicalDocumentRecipientEnvelopesAdopted:
      input.canonicalDocumentRecipientEnvelopesAdopted ?? false,
    commitLsn: input.commitLsn ?? null,
    currentAccessEpoch: input.accessEpoch,
    documentId: input.documentId,
    documentRecipientEnvelopeAction:
      input.documentRecipientEnvelopeAction ?? "none",
    documentRecipientEnvelopes: input.documentRecipientEnvelopes ?? null,
    missingUpdateEpochs: input.missingUpdateEpochs ?? [],
    rotateBaselineSourceVersionVector:
      input.rotateBaselineSourceVersionVector ?? null,
    recipientEncapsulationPublicKeys: input.recipientEncapsulationPublicKeys,
    updates: input.updates ?? [],
  };
}

async function createSqlRuntime(): Promise<TestRuntime> {
  const runtimeBase = await createSqlRuntimeBase("explorer-provider-test");

  return {
    ...runtimeBase,
    apiClient: {
      commitDocumentChange: async () => null,
      createContainer: async (
        _id: string,
        _parentId: string,
        _initialMetadataUpdates,
      ) => null,
      createDocument: async () => null,
      getBlob: async () => null,
      listContainers: async () => [],
      listDocumentAttachments: async () => null,
      moveContainer: async (_containerId: string, _parentId: string) => null,
      shareContainer: async (
        _containerId: string,
        _subjectType: "user" | "group" | "organization",
        _subjectId: string,
        _accessLevel: "read" | "write" | "admin",
      ) => null,
      stageBlob: async () => null,
      syncDocument: async () => null,
    },
  };
}

test("explorer store creates, renames, deletes, and reloads child containers", async () => {
  const runtime = await createSqlRuntime();

  try {
    await ensureContainerTables(runtime.execSql);
    await saveContainer(runtime.execSql, {
      id: "root-container",
      organizationId: "org-1",
      parentId: null,
      metadataDocumentId: null,
      name: "/",
      icon: null,
    });

    const firstStore = createExplorerStore(runtime);
    firstStore.updateRuntime(runtime);

    await waitForCondition(
      () => firstStore.getSnapshot().ready,
      "Explorer store did not become ready.",
    );

    expect(firstStore.getSnapshot()).toEqual({
      nodes: [
        {
          id: "root-container",
          kind: "container",
          name: "/",
          organizationId: "org-1",
          parentId: null,
        },
      ],
      ready: true,
    });

    const childNode = await firstStore.createChild("root-container", "Docs");
    if (!childNode) {
      throw new Error("Expected createChild to return a new container node.");
    }

    expect(childNode.name).toBe("Docs");
    expect(childNode.organizationId).toBe("org-1");
    expect(childNode.parentId).toBe("root-container");
    expect(firstStore.getSnapshot().nodes).toHaveLength(2);
    expect(
      firstStore
        .getSnapshot()
        .nodes.some(
          (node) =>
            node.id === childNode.id && node.parentId === "root-container",
        ),
    ).toBe(true);

    const renamedNode = await firstStore.renameContainer(
      childNode.id,
      "Manuals",
    );
    if (!renamedNode) {
      throw new Error("Expected renameContainer to return the renamed node.");
    }

    expect(renamedNode.id).toBe(childNode.id);
    expect(renamedNode.name).toBe("Manuals");
    expect(
      firstStore
        .getSnapshot()
        .nodes.some(
          (node) => node.id === childNode.id && node.name === "Manuals",
        ),
    ).toBe(true);

    const deletedRoot = await firstStore.deleteContainer("root-container");
    expect(deletedRoot).toBe(false);

    const deletedChild = await firstStore.deleteContainer(childNode.id);
    expect(deletedChild).toBe(true);
    expect(firstStore.getSnapshot().nodes).toHaveLength(1);
    expect(
      firstStore.getSnapshot().nodes.some((node) => node.id === childNode.id),
    ).toBe(false);

    const secondStore = createExplorerStore(runtime);
    secondStore.updateRuntime(runtime);

    await waitForCondition(
      () => secondStore.getSnapshot().ready,
      "Reloaded explorer store did not become ready.",
    );

    expect(secondStore.getSnapshot().nodes).toHaveLength(1);
    expect(
      secondStore.getSnapshot().nodes.some((node) => node.id === childNode.id),
    ).toBe(false);
  } finally {
    runtime.close();
  }
});

test("explorer sync agent batches concurrent remote ingests into one snapshot update", async () => {
  const runtime = await createSqlRuntime();
  let snapshotUpdateCount = 0;
  const cachedPrincipalBatches: number[] = [];

  runtime.cacheReferencedPrincipalPolicies = async (principals) => {
    cachedPrincipalBatches.push(principals?.length ?? 0);
  };

  try {
    await sqlExplorerPersistence.ensureSchema(runtime.execSql);

    const state: ExplorerSyncState = {
      containersById: new Map(),
      initializePromise: null,
      initialized: false,
      lastEventCount: 0,
      persistence: sqlExplorerPersistence,
      remoteHydrationPromise: null,
      runtime,
      snapshot: {
        ready: true,
      },
      syncLane: null,
    };
    const syncAgent = createExplorerSyncAgent({
      host: {
        persistContainerState: async (containerState) => {
          await sqlExplorerPersistence.saveContainer(
            runtime.execSql,
            containerState.container,
            containerState.record,
          );
          return containerState.record;
        },
        updateSnapshot: () => {
          snapshotUpdateCount += 1;
        },
      },
      state,
    });

    await Promise.all([
      syncAgent.ingestRemoteContainer({
        id: "container-a",
        metadataAccessEpoch: 1,
        metadataDocumentId: "metadata-document-a",
        metadataRecipientEncapsulationPublicKeys: [],
        metadataReferencedPrincipals: [
          {
            keyEpoch: 1,
            principalId: "group-a",
            principalType: "group",
            stateHash: "state-hash-a",
            version: 1,
          },
        ],
        organizationId: "org-1",
        parentId: null,
      }),
      syncAgent.ingestRemoteContainer({
        id: "container-b",
        metadataAccessEpoch: 1,
        metadataDocumentId: "metadata-document-b",
        metadataRecipientEncapsulationPublicKeys: [],
        metadataReferencedPrincipals: [
          {
            keyEpoch: 1,
            principalId: "group-b",
            principalType: "group",
            stateHash: "state-hash-b",
            version: 1,
          },
        ],
        organizationId: "org-1",
        parentId: "container-a",
      }),
    ]);

    expect(snapshotUpdateCount).toBe(1);
    expect(state.containersById.size).toBe(2);
    expect(cachedPrincipalBatches).toEqual([2]);
  } finally {
    runtime.close();
  }
});

test("explorer store creates authenticated child containers through the API before persisting locally", async () => {
  const runtime = await createSqlRuntime();
  const localKeyPair = generateKemSeedAndKeyPair();
  const createContainerCalls: Array<{
    id: string;
    initialMetadataUpdateCount: number;
    parentId: string;
  }> = [];

  runtime.isAuthenticated = true;
  runtime.encapsulationKeyPair = localKeyPair;
  runtime.apiClient = {
    ...runtime.apiClient,
    createContainer: async (
      id: string,
      parentId: string,
      initialMetadataUpdates,
    ) => {
      createContainerCalls.push({
        id,
        initialMetadataUpdateCount: initialMetadataUpdates.length,
        parentId,
      });
      return {
        id,
        metadataAccessEpoch: 1,
        metadataDocumentId: "metadata-document-1",
        metadataRecipientEncapsulationPublicKeys: [
          bytesToBase64(localKeyPair.publicKey),
        ],
        organizationId: "org-1",
        parentId,
      };
    },
    listContainers: async () => [],
    shareContainer: async () => null,
    syncDocument: async () => null,
  };
  try {
    await ensureContainerTables(runtime.execSql);
    await saveContainer(runtime.execSql, {
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

    const childNode = await store.createChild("root-container", "Docs");
    if (!childNode) {
      throw new Error("Expected createChild to return a new container node.");
    }

    expect(createContainerCalls).toEqual([
      {
        id: childNode.id,
        initialMetadataUpdateCount: 1,
        parentId: "root-container",
      },
    ]);

    const persistedContainers = await loadContainers(runtime.execSql);
    const persistedChild = persistedContainers.find(
      (container) => container.id === childNode.id,
    );

    expect(persistedChild).not.toBeUndefined();
    expect(persistedChild?.metadataDocumentId).toBe("metadata-document-1");
    expect(persistedChild?.name).toBe("Docs");
    expect(childNode.organizationId).toBe("org-1");
    expect(childNode.parentId).toBe("root-container");
  } finally {
    runtime.close();
  }
});

test("explorer store creates a child under a writable shared root using the inherited recipient set", async () => {
  const runtime = await createSqlRuntime();
  const cachedPrincipalReferences: Array<
    ReadonlyArray<{
      keyEpoch: number;
      principalId: string;
      principalType: "group" | "organization";
      stateHash: string;
      version: number;
    }>
  > = [];
  const ownerKeyPair = generateKemSeedAndKeyPair();
  const localKeyPair = generateKemSeedAndKeyPair();
  const expectedRecipientFingerprints = [
    await toFingerprint(ownerKeyPair.publicKey),
    await toFingerprint(localKeyPair.publicKey),
  ].sort();
  const createContainerCalls: Array<{
    id: string;
    initialMetadataRecipientFingerprints: string[];
    parentId: string;
  }> = [];

  runtime.isAuthenticated = true;
  runtime.online = true;
  runtime.encapsulationKeyPair = localKeyPair;
  runtime.cacheReferencedPrincipalPolicies = async (references) => {
    cachedPrincipalReferences.push(references ?? []);
  };
  runtime.apiClient = {
    ...runtime.apiClient,
    createContainer: async (
      id: string,
      parentId: string,
      _initialMetadataUpdates,
      initialMetadataRecipientEnvelopes,
    ) => {
      createContainerCalls.push({
        id,
        initialMetadataRecipientFingerprints: [
          ...(initialMetadataRecipientEnvelopes ?? []),
        ]
          .map((recipient) => recipient.keyFingerprint)
          .sort(),
        parentId,
      });
      return {
        id,
        metadataAccessEpoch: 1,
        metadataDocumentId: "metadata-document-2",
        metadataRecipientEncapsulationPublicKeys: [
          bytesToBase64(ownerKeyPair.publicKey),
          bytesToBase64(localKeyPair.publicKey),
        ],
        metadataReferencedPrincipals: [
          {
            keyEpoch: 1,
            principalId: "group-1",
            principalType: "group",
            stateHash: "state-hash-1",
            version: 1,
          },
        ],
        organizationId: "org-2",
        parentId,
      };
    },
    listContainers: async () => [
      {
        id: "shared-root-container",
        metadataAccessEpoch: 1,
        metadataDocumentId: "shared-root-metadata-document",
        metadataRecipientEncapsulationPublicKeys: [
          bytesToBase64(ownerKeyPair.publicKey),
          bytesToBase64(localKeyPair.publicKey),
        ],
        metadataReferencedPrincipals: [
          {
            keyEpoch: 1,
            principalId: "group-1",
            principalType: "group",
            stateHash: "state-hash-1",
            version: 1,
          },
        ],
        organizationId: "org-2",
        parentId: null,
      },
    ],
    shareContainer: async () => null,
    syncDocument: async () => null,
  };

  try {
    const store = createExplorerStore(runtime);
    store.updateRuntime(runtime);

    await waitForCondition(
      () =>
        store
          .getSnapshot()
          .nodes.some((node) => node.id === "shared-root-container"),
      "Explorer store did not hydrate the shared root container.",
    );

    const childNode = await store.createChild("shared-root-container", "Docs");
    if (!childNode) {
      throw new Error("Expected createChild to return a new container node.");
    }

    expect(createContainerCalls).toEqual([
      {
        id: childNode.id,
        initialMetadataRecipientFingerprints: expectedRecipientFingerprints,
        parentId: "shared-root-container",
      },
    ]);
    expect(cachedPrincipalReferences).toContainEqual([
      {
        keyEpoch: 1,
        principalId: "group-1",
        principalType: "group",
        stateHash: "state-hash-1",
        version: 1,
      },
    ]);
  } finally {
    runtime.close();
  }
});

test("explorer store moves an authenticated child container through the API and refreshes local state", async () => {
  const runtime = await createSqlRuntime();
  const localKeyPair = generateKemSeedAndKeyPair();
  const recipientPublicKeys = [bytesToBase64(localKeyPair.publicKey)];
  const moveContainerCalls: Array<{
    containerId: string;
    parentId: string;
  }> = [];
  let remoteContainers = [
    {
      id: "root-container",
      metadataAccessEpoch: 1,
      metadataDocumentId: "root-metadata-document",
      metadataRecipientEncapsulationPublicKeys: recipientPublicKeys,
      organizationId: "org-1",
      parentId: null,
    },
    {
      id: "parent-a",
      metadataAccessEpoch: 1,
      metadataDocumentId: "parent-a-metadata-document",
      metadataRecipientEncapsulationPublicKeys: recipientPublicKeys,
      organizationId: "org-1",
      parentId: "root-container",
    },
    {
      id: "parent-b",
      metadataAccessEpoch: 1,
      metadataDocumentId: "parent-b-metadata-document",
      metadataRecipientEncapsulationPublicKeys: recipientPublicKeys,
      organizationId: "org-1",
      parentId: "root-container",
    },
    {
      id: "child-container",
      metadataAccessEpoch: 1,
      metadataDocumentId: "child-metadata-document",
      metadataRecipientEncapsulationPublicKeys: recipientPublicKeys,
      organizationId: "org-1",
      parentId: "parent-a",
    },
  ];

  runtime.isAuthenticated = true;
  runtime.online = true;
  runtime.encapsulationKeyPair = localKeyPair;
  runtime.apiClient = {
    ...runtime.apiClient,
    listContainers: async () => remoteContainers,
    moveContainer: async (containerId, parentId) => {
      moveContainerCalls.push({ containerId, parentId });
      remoteContainers = remoteContainers.map((container) =>
        container.id === containerId
          ? {
              ...container,
              metadataAccessEpoch: container.metadataAccessEpoch + 1,
              parentId,
            }
          : container,
      );
      return (
        remoteContainers.find((container) => container.id === containerId) ??
        null
      );
    },
    shareContainer: async () => null,
    syncDocument: async () => null,
  };

  try {
    const store = createExplorerStore(runtime);
    store.updateRuntime(runtime);

    await waitForCondition(
      () =>
        store.getSnapshot().nodes.some((node) => node.id === "child-container"),
      "Explorer store did not hydrate remote containers before move.",
    );

    const movedNode = await store.moveContainer("child-container", "parent-b");
    if (!movedNode) {
      throw new Error("Expected moveContainer to return the moved node.");
    }

    await waitForCondition(
      () =>
        store
          .getSnapshot()
          .nodes.some(
            (node) =>
              node.id === "child-container" && node.parentId === "parent-b",
          ),
      "Explorer store did not update the moved container parent.",
    );

    expect(moveContainerCalls).toEqual([
      { containerId: "child-container", parentId: "parent-b" },
    ]);
    expect(movedNode.parentId).toBe("parent-b");

    const persistedContainers = await loadContainers(runtime.execSql);
    expect(
      persistedContainers.find(
        (container) => container.id === "child-container",
      )?.parentId,
    ).toBe("parent-b");
  } finally {
    runtime.close();
  }
});

test("explorer store shares an authenticated container and seeds metadata rewrap envelopes without a new baseline", async () => {
  const runtime = await createSqlRuntime();
  const localKeyPair = generateKemSeedAndKeyPair();
  const peerKeyPair = generateKemSeedAndKeyPair();
  const shareContainerCalls: Array<{
    accessLevel: "read" | "write" | "admin";
    containerId: string;
    subjectId: string;
    subjectType: "user" | "group" | "organization";
  }> = [];
  const syncCalls: Array<{
    accessEpoch: number;
    documentRecipientEnvelopeCount: number;
    documentId: string;
    outgoingUpdateCount: number;
  }> = [];
  let sharedMetadataSyncCallCount = 0;
  let initialMetadataDocumentRecipientEnvelopes:
    | SyncDocumentResponse["documentRecipientEnvelopes"]
    | null = null;

  runtime.isAuthenticated = true;
  runtime.online = true;
  runtime.encapsulationKeyPair = localKeyPair;
  runtime.apiClient = {
    ...runtime.apiClient,
    createContainer: async () => null,
    listContainers: async () => [],
    shareContainer: async (
      containerId: string,
      subjectType: "user" | "group" | "organization",
      subjectId: string,
      accessLevel: "read" | "write" | "admin",
    ) => {
      shareContainerCalls.push({
        accessLevel,
        containerId,
        subjectId,
        subjectType,
      });
      return {
        id: containerId,
        metadataAccessEpoch: 2,
        metadataDocumentId: "metadata-document-1",
        metadataRecipientEncapsulationPublicKeys: [
          bytesToBase64(localKeyPair.publicKey),
          bytesToBase64(peerKeyPair.publicKey),
        ],
      };
    },
    syncDocument: async (
      documentId,
      accessEpoch,
      _localVersionVector,
      updates,
      documentRecipientEnvelopes,
    ) => {
      syncCalls.push({
        accessEpoch,
        documentRecipientEnvelopeCount: documentRecipientEnvelopes?.length ?? 0,
        documentId,
        outgoingUpdateCount: updates.length,
      });
      if (documentId === "metadata-document-1" && accessEpoch === 2) {
        sharedMetadataSyncCallCount += 1;
      }
      if (
        documentId === "metadata-document-1" &&
        accessEpoch === 2 &&
        sharedMetadataSyncCallCount === 1
      ) {
        return createSyncDocumentResponse({
          accessEpoch,
          documentId,
          documentRecipientEnvelopeAction: "rewrap",
          recipientEncapsulationPublicKeys: [
            bytesToBase64(localKeyPair.publicKey),
            bytesToBase64(peerKeyPair.publicKey),
          ],
        });
      }
      return createSyncDocumentResponse({
        acceptedOutgoingUpdateIds: updates.map((update) => update.id),
        accessEpoch,
        documentId,
        documentRecipientEnvelopes:
          documentId === "metadata-document-1" && accessEpoch === 1
            ? initialMetadataDocumentRecipientEnvelopes
            : (documentRecipientEnvelopes ?? null),
        recipientEncapsulationPublicKeys: [
          bytesToBase64(localKeyPair.publicKey),
          bytesToBase64(peerKeyPair.publicKey),
        ],
      });
    },
  };
  let store: ReturnType<typeof createExplorerStore> | null = null;

  try {
    await ensureContainerTables(runtime.execSql);
    await ensureDocumentTables(runtime.execSql);
    await saveContainer(runtime.execSql, {
      id: "root-container",
      organizationId: "org-1",
      parentId: null,
      metadataDocumentId: "root-metadata-document",
      name: "/",
      icon: null,
    });
    await saveContainer(runtime.execSql, {
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
    const initialEncryption = await createDocumentEncryptionMaterial([
      localKeyPair.publicKey,
    ]);
    initialMetadataDocumentRecipientEnvelopes =
      initialEncryption.documentRecipientEnvelopes;
    await saveDocumentRecord(
      runtime.execSql,
      {
        appKind: "container-metadata",
        localId: "child-container",
      },
      {
        accessEpoch: 1,
        documentId: "metadata-document-1",
        documentRecipientEnvelopes: serializeDocumentRecipientEnvelopes(
          initialEncryption.documentRecipientEnvelopes,
        ),
        id: "child-container",
        loroSnapshot: bytesToBase64(initialUpdate),
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

    const shared = await createdStore.shareWithUser(
      "child-container",
      "550e8400-e29b-41d4-a716-446655440000",
    );

    expect(shared).toBe(true);

    await waitForCondition(
      () =>
        syncCalls.some(
          (call) =>
            call.accessEpoch === 2 &&
            call.documentId === "metadata-document-1" &&
            call.documentRecipientEnvelopeCount === 2 &&
            call.outgoingUpdateCount === 0,
        ),
      `Explorer store did not seed current-epoch metadata envelopes after share.\nsyncCalls=${JSON.stringify(
        syncCalls,
      )}`,
    );

    expect(shareContainerCalls).toEqual([
      {
        accessLevel: "write",
        containerId: "child-container",
        subjectId: "550e8400-e29b-41d4-a716-446655440000",
        subjectType: "user",
      },
    ]);
    const metadataSyncCalls = syncCalls.filter(
      (call) => call.documentId === "metadata-document-1",
    );
    expect(metadataSyncCalls).toContainEqual({
      accessEpoch: 1,
      documentRecipientEnvelopeCount: 0,
      documentId: "metadata-document-1",
      outgoingUpdateCount: 0,
    });
    expect(metadataSyncCalls).toContainEqual({
      accessEpoch: 2,
      documentRecipientEnvelopeCount: 0,
      documentId: "metadata-document-1",
      outgoingUpdateCount: 0,
    });
    expect(metadataSyncCalls).toContainEqual({
      accessEpoch: 2,
      documentRecipientEnvelopeCount: 2,
      documentId: "metadata-document-1",
      outgoingUpdateCount: 0,
    });
  } finally {
    if (store) {
      runtime.dbStatus = "terminated";
      store.updateRuntime(runtime);
    }
    runtime.close();
  }
}, 20_000);

test("explorer store persists commitLsn and reuses it as minLsn on the next metadata sync", async () => {
  const runtime = await createSqlRuntime();
  const localKeyPair = generateKemSeedAndKeyPair();
  const syncCalls: Array<{
    minLsn: string | null;
    outgoingUpdateCount: number;
  }> = [];
  let syncCallCount = 0;
  let store: ReturnType<typeof createExplorerStore> | null = null;

  runtime.isAuthenticated = true;
  runtime.online = true;
  runtime.encapsulationKeyPair = localKeyPair;
  runtime.apiClient = {
    ...runtime.apiClient,
    createContainer: async () => null,
    listContainers: async () => [],
    shareContainer: async (containerId) => ({
      id: containerId,
      metadataAccessEpoch: 2,
      metadataDocumentId: "metadata-document-1",
      metadataRecipientEncapsulationPublicKeys: [
        bytesToBase64(localKeyPair.publicKey),
      ],
    }),
    syncDocument: async (
      documentId,
      accessEpoch,
      _localVersionVector,
      updates,
      documentRecipientEnvelopes,
      minLsn,
    ) => {
      syncCallCount += 1;
      syncCalls.push({
        minLsn: minLsn ?? null,
        outgoingUpdateCount: updates.length,
      });

      return createSyncDocumentResponse({
        acceptedOutgoingUpdateIds: updates.map((update) => update.id),
        accessEpoch,
        commitLsn: syncCallCount === 1 ? "0/10" : "0/20",
        documentId,
        documentRecipientEnvelopes: documentRecipientEnvelopes ?? null,
        recipientEncapsulationPublicKeys: [
          bytesToBase64(localKeyPair.publicKey),
        ],
      });
    },
  };

  try {
    await ensureContainerTables(runtime.execSql);
    await saveContainer(runtime.execSql, {
      id: "root-container",
      organizationId: "org-1",
      parentId: null,
      metadataDocumentId: "root-metadata-document",
      name: "/",
      icon: null,
    });
    await saveContainer(runtime.execSql, {
      id: "child-container",
      organizationId: "org-1",
      parentId: "root-container",
      metadataDocumentId: "metadata-document-1",
      name: "Docs",
      icon: null,
    });

    const createdStore = createExplorerStore(runtime);
    store = createdStore;
    createdStore.updateRuntime(runtime);

    await waitForCondition(
      () => createdStore.getSnapshot().ready,
      "Explorer store did not become ready.",
    );

    expect(
      await createdStore.shareWithUser(
        "child-container",
        "550e8400-e29b-41d4-a716-446655440000",
      ),
    ).toBe(true);

    await waitForCondition(
      () => syncCalls.some((call) => call.minLsn === null),
      "Initial metadata sync did not complete.",
    );

    await createdStore.renameContainer("child-container", "Docs v2");

    await waitForCondition(async () => {
      const pendingRows = await runtime.execSql(
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
        syncCalls.some((call) => call.minLsn === "0/10") && pendingCount === 0
      );
    }, "Follow-up metadata sync did not complete.");

    expect(syncCalls.some((call) => call.minLsn === null)).toBe(true);
    expect(syncCalls.some((call) => call.minLsn === "0/10")).toBe(true);
  } finally {
    if (store) {
      runtime.dbStatus = "terminated";
      store.updateRuntime(runtime);
    }
    runtime.close();
  }
});

test("explorer store rotates metadata epochs with a fresh current-epoch bundle", async () => {
  const runtime = await createSqlRuntime();
  const localKeyPair = generateKemSeedAndKeyPair();
  const syncCalls: Array<{
    accessEpoch: number;
    documentId: string;
    documentRecipientEnvelopeCount: number;
    outgoingSourceVersionVectors: Array<string | null>;
    outgoingUpdateCount: number;
  }> = [];
  let store: ReturnType<typeof createExplorerStore> | null = null;
  let childDocumentSyncCallCount = 0;

  try {
    await ensureContainerTables(runtime.execSql);
    await ensureDocumentTables(runtime.execSql);

    await saveContainer(runtime.execSql, {
      id: "root-container",
      organizationId: "org-1",
      parentId: null,
      metadataDocumentId: "root-metadata-document",
      name: "/",
      icon: null,
    });
    await saveContainer(runtime.execSql, {
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
    const initialEncryption = await createDocumentEncryptionMaterial([
      localKeyPair.publicKey,
    ]);
    await saveDocumentRecord(
      runtime.execSql,
      {
        appKind: "container-metadata",
        localId: "child-container",
      },
      {
        accessEpoch: 1,
        documentId: "metadata-document-1",
        documentRecipientEnvelopes: serializeDocumentRecipientEnvelopes(
          initialEncryption.documentRecipientEnvelopes,
        ),
        id: "child-container",
        loroSnapshot: bytesToBase64(initialUpdate),
      },
      new Date("2026-04-09T12:00:00.000Z").toISOString(),
    );

    const createdStore = createExplorerStore(runtime);
    store = createdStore;
    createdStore.updateRuntime(runtime);

    await waitForCondition(
      () => createdStore.getSnapshot().ready,
      "Explorer store did not become ready for rotate handling.",
    );

    const renamed = await createdStore.renameContainer(
      "child-container",
      "Manuals",
    );
    expect(renamed?.name).toBe("Manuals");

    const syncedRuntime: ExplorerRuntime = {
      ...runtime,
      encapsulationKeyPair: localKeyPair,
      isAuthenticated: true,
      online: true,
      apiClient: {
        ...runtime.apiClient,
        createContainer: async () => null,
        listContainers: async () => [],
        shareContainer: async () => null,
        syncDocument: async (
          documentId,
          accessEpoch,
          _localVersionVector,
          updates,
          documentRecipientEnvelopes,
        ) => {
          syncCalls.push({
            accessEpoch,
            documentId,
            documentRecipientEnvelopeCount:
              documentRecipientEnvelopes?.length ?? 0,
            outgoingSourceVersionVectors: updates.map(
              (update) => update.sourceVersionVector ?? null,
            ),
            outgoingUpdateCount: updates.length,
          });

          if (documentId === "metadata-document-1") {
            childDocumentSyncCallCount += 1;
          }

          if (
            documentId === "metadata-document-1" &&
            childDocumentSyncCallCount === 1
          ) {
            return createSyncDocumentResponse({
              accessEpoch: 2,
              documentId,
              documentRecipientEnvelopeAction: "rotate",
              rotateBaselineSourceVersionVector: "metadata-frontier-1",
              recipientEncapsulationPublicKeys: [
                bytesToBase64(localKeyPair.publicKey),
              ],
            });
          }

          return createSyncDocumentResponse({
            acceptedOutgoingUpdateIds: updates.map((update) => update.id),
            accessEpoch,
            documentId,
            documentRecipientEnvelopes: documentRecipientEnvelopes ?? null,
            recipientEncapsulationPublicKeys: [
              bytesToBase64(localKeyPair.publicKey),
            ],
          });
        },
      },
    };

    createdStore.updateRuntime(syncedRuntime);

    await waitForCondition(
      () =>
        syncCalls.some(
          (call) =>
            call.accessEpoch === 2 &&
            call.documentRecipientEnvelopeCount === 1 &&
            call.outgoingSourceVersionVectors[0] === "metadata-frontier-1" &&
            call.outgoingUpdateCount === 1,
        ),
      "Explorer rotate sync did not resend a fresh metadata baseline.",
    );

    expect(syncCalls).toContainEqual({
      accessEpoch: 1,
      documentId: "metadata-document-1",
      documentRecipientEnvelopeCount: 0,
      outgoingSourceVersionVectors: [null],
      outgoingUpdateCount: 1,
    });
    expect(syncCalls).toContainEqual({
      accessEpoch: 2,
      documentId: "metadata-document-1",
      documentRecipientEnvelopeCount: 1,
      outgoingSourceVersionVectors: ["metadata-frontier-1"],
      outgoingUpdateCount: 1,
    });
  } finally {
    if (store) {
      runtime.dbStatus = "terminated";
      store.updateRuntime(runtime);
    }
    runtime.close();
  }
});

test("explorer share primes note attachment rewrap work for linked notes in the shared subtree", async () => {
  const runtime = await createSqlRuntime();
  const localKeyPair = generateKemSeedAndKeyPair();
  const shareContainerCalls: Array<{
    accessLevel: "read" | "write" | "admin";
    containerId: string;
    subjectId: string;
    subjectType: "user" | "group" | "organization";
  }> = [];
  const commitChangeCalls: Array<{
    accessEpoch: number;
    attachmentCommitCount: number;
    attachmentRewrapCount: number;
    documentId: string;
    expectedBindingIds: Array<string | null>;
  }> = [];
  const noteSyncCalls: Array<{
    accessEpoch: number;
    documentRecipientEnvelopeCount: number;
    outgoingUpdateCount: number;
  }> = [];
  let commitCallCount = 0;
  let currentBindingId: string | null = null;
  let currentBlobId: string | null = null;
  let currentBlobEncryptedBytes: string | null = null;
  let currentSlotId: string | null = null;
  let noteSyncCallCount = 0;

  runtime.isAuthenticated = true;
  runtime.online = true;
  runtime.encapsulationKeyPair = localKeyPair;
  runtime.apiClient = {
    ...runtime.apiClient,
    commitDocumentChange: async (documentId, input) => {
      commitCallCount += 1;
      commitChangeCalls.push({
        accessEpoch: input.accessEpoch,
        attachmentCommitCount: input.attachmentCommits.length,
        attachmentRewrapCount: input.attachmentRewraps.length,
        documentId,
        expectedBindingIds: [
          ...input.attachmentCommits.map((commit) => commit.expectedBindingId),
          ...input.attachmentRewraps.map(
            (attachmentRewrap) => attachmentRewrap.expectedBindingId,
          ),
        ],
      });

      const committedBindings = input.attachmentCommits.map((commit, index) => {
        const bindingId = `binding-${commitCallCount}-${index + 1}`;
        const blobId = `blob-${commitCallCount}-${index + 1}`;
        currentBindingId = bindingId;
        currentBlobId = blobId;

        return {
          bindingId,
          blobId,
          slotId: commit.slotId,
        };
      });

      return {
        acceptedOutgoingUpdateIds: input.loroUpdate
          ? [input.loroUpdate.id]
          : [],
        committedBindings,
        currentAccessEpoch: input.accessEpoch,
        documentRecipientEnvelopes: null,
        detachedBindingIds: [],
      };
    },
    getBlob: async (blobId) => {
      if (
        !currentBlobId ||
        !currentBlobEncryptedBytes ||
        blobId !== currentBlobId
      ) {
        return null;
      }

      return {
        blobId,
        encryptedBytes: currentBlobEncryptedBytes,
        sha256: "shared-note-blob",
      };
    },
    createContainer: async () => null,
    createDocument: async () => ({
      createdAt: "2026-03-31T00:00:00.000Z",
      currentAccessEpoch: 1,
      documentRecipientEnvelopes: null,
      id: "notes-document-1",
      recipientEncapsulationPublicKeys: [bytesToBase64(localKeyPair.publicKey)],
    }),
    listContainers: async () => [],
    listDocumentAttachments: async () => {
      if (!currentBindingId || !currentBlobId || !currentSlotId) {
        return [];
      }

      return [
        {
          bindingId: currentBindingId,
          blobId: currentBlobId,
          slotId: currentSlotId,
        },
      ];
    },
    shareContainer: async (
      containerId: string,
      subjectType: "user" | "group" | "organization",
      subjectId: string,
      accessLevel: "read" | "write" | "admin",
    ) => {
      shareContainerCalls.push({
        accessLevel,
        containerId,
        subjectId,
        subjectType,
      });
      return {
        id: containerId,
        metadataAccessEpoch: 2,
        metadataDocumentId:
          containerId === "child-container"
            ? "child-metadata-document"
            : "root-metadata-document",
        metadataRecipientEncapsulationPublicKeys: [
          bytesToBase64(localKeyPair.publicKey),
        ],
      };
    },
    stageBlob: async (input) => {
      currentBlobEncryptedBytes = input.encryptedBytes;
      return {
        expiresAt: "2026-04-07T00:00:00.000Z",
        stageId: crypto.randomUUID(),
      };
    },
    syncDocument: async (
      documentId,
      accessEpoch,
      _localVersionVector,
      updates,
      documentRecipientEnvelopes,
    ) => {
      if (documentId === "notes-document-1") {
        noteSyncCallCount += 1;
        noteSyncCalls.push({
          accessEpoch,
          documentRecipientEnvelopeCount:
            documentRecipientEnvelopes?.length ?? 0,
          outgoingUpdateCount: updates.length,
        });

        if (noteSyncCallCount === 2) {
          return createSyncDocumentResponse({
            acceptedOutgoingUpdateIds: updates.map((update) => update.id),
            accessEpoch: 2,
            documentId,
            documentRecipientEnvelopeAction: "rewrap",
            recipientEncapsulationPublicKeys: [
              bytesToBase64(localKeyPair.publicKey),
            ],
          });
        }
      }

      return createSyncDocumentResponse({
        acceptedOutgoingUpdateIds: updates.map((update) => update.id),
        accessEpoch,
        documentId,
        recipientEncapsulationPublicKeys: [
          bytesToBase64(localKeyPair.publicKey),
        ],
      });
    },
  };
  let store: ReturnType<typeof createExplorerStore> | null = null;
  let noteStore: ReturnType<typeof primeNotesStore> | null = null;
  const noteRuntime = {
    ...runtime,
    containerId: "root-container",
  };

  try {
    await ensureContainerTables(runtime.execSql);
    await saveContainer(runtime.execSql, {
      id: "root-container",
      organizationId: "org-1",
      parentId: null,
      metadataDocumentId: "root-metadata-document",
      name: "/",
      icon: null,
    });
    await saveContainer(runtime.execSql, {
      id: "child-container",
      organizationId: "org-1",
      parentId: "root-container",
      metadataDocumentId: "child-metadata-document",
      name: "Shared",
      icon: null,
    });

    const createdNoteStore = primeNotesStore(
      runtime.domainScope,
      "default",
      noteRuntime,
    );
    noteStore = createdNoteStore;

    await waitForCondition(
      () => createdNoteStore.getSnapshot().ready,
      "Notes store did not become ready before share fanout.",
    );

    createdNoteStore.attachFiles([
      {
        bytes: new TextEncoder().encode("attachment before share"),
        mimeType: "image/png",
        name: "before-share.png",
      },
    ]);

    await waitForCondition(async () => {
      const localAttachments = await sqlNotesPersistence.listLocalAttachments(
        runtime.execSql,
        "default",
      );
      const pendingAttachments =
        await sqlNotesPersistence.listPendingAttachments(
          runtime.execSql,
          "default",
        );

      return (
        commitChangeCalls.length === 1 &&
        noteSyncCallCount >= 1 &&
        pendingAttachments.length === 0 &&
        localAttachments.some((attachment) => !!attachment.blobId)
      );
    }, "Initial note attachment sync did not fully complete.");

    currentSlotId =
      createdNoteStore.getSnapshot().attachments[0]?.slotId ?? null;
    expect(currentSlotId).toBeString();

    await sqlDocumentContainerProjectionPersistence.replaceDocumentLinksBatch(
      runtime.execSql,
      [
        {
          containerIds: ["child-container", "root-container"],
          documentId: "notes-document-1",
        },
      ],
    );

    const createdStore = createExplorerStore(runtime);
    store = createdStore;
    createdStore.updateRuntime(runtime);

    await waitForCondition(
      () => createdStore.getSnapshot().ready,
      "Explorer store did not become ready before share fanout.",
    );

    const shared = await createdStore.shareWithUser(
      "child-container",
      "550e8400-e29b-41d4-a716-446655440000",
    );

    expect(shared).toBe(true);

    await waitForCondition(
      () => noteSyncCallCount >= 2,
      "Explorer share did not trigger a note resync.",
    );

    await waitForCondition(
      async () =>
        (
          await sqlNotesPersistence.listPendingAttachmentRewraps(
            runtime.execSql,
            "default",
          )
        ).length > 0 || commitChangeCalls.length === 2,
      "Explorer share did not queue note attachment rewrap work.",
    );

    const pendingAttachmentRewraps =
      await sqlNotesPersistence.listPendingAttachmentRewraps(
        runtime.execSql,
        "default",
      );

    expect(shareContainerCalls).toEqual([
      {
        accessLevel: "write",
        containerId: "child-container",
        subjectId: "550e8400-e29b-41d4-a716-446655440000",
        subjectType: "user",
      },
    ]);
    expect(commitChangeCalls[0]).toEqual({
      accessEpoch: 1,
      attachmentCommitCount: 1,
      attachmentRewrapCount: 0,
      documentId: "notes-document-1",
      expectedBindingIds: [null],
    });
    expect(
      commitChangeCalls.length === 2 || pendingAttachmentRewraps.length === 1,
    ).toBe(true);
    expect(noteSyncCalls).toContainEqual({
      accessEpoch: 2,
      documentRecipientEnvelopeCount: 0,
      outgoingUpdateCount: 0,
    });
    expect(noteSyncCalls).toContainEqual({
      accessEpoch: 2,
      documentRecipientEnvelopeCount: 1,
      outgoingUpdateCount: 1,
    });
    if (commitChangeCalls.length === 2) {
      expect(commitChangeCalls[1]).toEqual({
        accessEpoch: 2,
        attachmentCommitCount: 0,
        attachmentRewrapCount: 1,
        documentId: "notes-document-1",
        expectedBindingIds: ["binding-1-1"],
      });
    } else {
      expect(pendingAttachmentRewraps).toEqual([
        {
          blobId: currentBlobId ?? "",
          noteId: "default",
          slotId: currentSlotId ?? "",
        },
      ]);
    }
  } finally {
    if (store) {
      runtime.dbStatus = "terminated";
      store.updateRuntime(runtime);
    }
    if (noteStore) {
      runtime.dbStatus = "terminated";
      noteStore.updateRuntime(noteRuntime);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
    runtime.close();
  }
});

test("explorer store refreshes remote containers on demand after initialization", async () => {
  const runtime = await createSqlRuntime();
  const localKeyPair = generateKemSeedAndKeyPair();
  let listContainersCalls = 0;

  runtime.isAuthenticated = true;
  runtime.online = true;
  runtime.encapsulationKeyPair = localKeyPair;
  runtime.apiClient = {
    ...runtime.apiClient,
    createContainer: async () => null,
    listContainers: async () => {
      listContainersCalls += 1;

      if (listContainersCalls === 1) {
        return [];
      }

      return [
        {
          id: "shared-root-container",
          metadataAccessEpoch: 1,
          metadataDocumentId: "shared-root-metadata-document",
          metadataRecipientEncapsulationPublicKeys: [
            bytesToBase64(localKeyPair.publicKey),
          ],
          organizationId: "org-2",
          parentId: null,
        },
      ];
    },
    shareContainer: async () => null,
    syncDocument: async () => null,
  };
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

    expect(listContainersCalls).toBeGreaterThanOrEqual(2);
  } finally {
    if (store) {
      runtime.dbStatus = "terminated";
      store.updateRuntime(runtime);
    }
    runtime.close();
  }
});

import { expect, test } from "bun:test";
import {
  type AccessEventV2,
  computeAccessEventHash,
  computeWriteHeaderHash,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
  type WriteHeaderV2,
  wrapDekForRecipients,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import type {
  DocumentV2CreateRequest,
  DocumentV2SyncRequest,
} from "@tearleads/validators/request";
import type {
  ContainerV2WriterProjectionResponse,
  DocumentV2CreateResponse,
  DocumentV2SyncResponse,
  DocumentV2WriterProjectionResponse,
} from "@tearleads/validators/response";
import { createSqlRuntimeBase } from "../../../../test/helpers/createSqlRuntime";
import { waitForCondition } from "../../../../test/helpers/waitForCondition";
import {
  createInitializedContainerMetadataDocument,
  ensureContainerTables,
  loadContainers,
  saveContainer,
} from "../../../data/containers";
import {
  createDocumentEncryptionMaterial,
  serializeDocumentRecipientEnvelopes,
} from "../../../data/documentSync";
import {
  buildMaterializedDocumentV2CreatePlan,
  persistedDocumentV2CreateStateFromResponse,
} from "../../../data/documents/documentV2Runtime";
import {
  ensureDocumentTables,
  saveDocumentRecord,
} from "../../../data/persistence/documentPersistence";
import { readSqlRowValue } from "../../../data/persistence/sqlSchema";
import { sqlExplorerPersistence } from "../explorerPersistence";
import { createExplorerStore } from "./ExplorerProvider";
import {
  createExplorerSyncAgent,
  type ExplorerSyncState,
} from "./explorerSyncAgent";

type ExplorerRuntime = Parameters<typeof createExplorerStore>[0];
type TestRuntime = ExplorerRuntime & { close: () => void };
type ListedContainer = NonNullable<
  Awaited<ReturnType<TestRuntime["apiClient"]["listContainers"]>>
>[number];

async function explorerMetadataV2FixtureHash(label: string): Promise<string> {
  return toFingerprint(new TextEncoder().encode(`explorer-v2:${label}`));
}

async function createExplorerMetadataV2ContainerProjection(input: {
  containerId: string;
  encapsulationPublicKey: Uint8Array;
  organizationId: string;
  userId: string;
}): Promise<ContainerV2WriterProjectionResponse> {
  const manifestHash = await explorerMetadataV2FixtureHash(
    `${input.containerId}:manifest`,
  );
  const eventHash = await explorerMetadataV2FixtureHash(
    `${input.containerId}:event`,
  );
  const keyEpochHash = await explorerMetadataV2FixtureHash(
    `${input.containerId}:key-epoch`,
  );
  const keyTargetHash = await explorerMetadataV2FixtureHash(
    `${input.containerId}:key-target`,
  );
  const containerKeyEpochId = `${input.containerId}-key-epoch-1`;
  const containerKek = crypto.getRandomValues(new Uint8Array(32));
  const [recipient] = await wrapDekForRecipients(containerKek, [
    input.encapsulationPublicKey,
  ]);
  if (!recipient) {
    throw new Error("Expected V2 explorer metadata fixture recipient wrap.");
  }

  return {
    containerId: input.containerId,
    organizationId: input.organizationId,
    path: [
      {
        event: { event: {}, body: {}, eventHash },
        manifest: {},
        manifestHash,
        state: {
          containerId: input.containerId,
          organizationId: input.organizationId,
        },
      },
    ],
    containerKeks: [
      {
        containerId: input.containerId,
        accessManifestHash: manifestHash,
        containerKeyEpochId,
        containerKeyEpoch: 1,
        keyEpoch: {
          id: containerKeyEpochId,
          containerId: input.containerId,
          keyEpoch: 1,
          accessManifestHash: manifestHash,
          parentContainerKeyEpochId: null,
          createdByEventHash: eventHash,
          createdByManifestHash: manifestHash,
        },
        keyEpochHash,
        keyTargetHash,
        parentContainerKeyEpochId: null,
        recipientTargets: [{}],
        wraps: [
          {
            containerKeyEpochId,
            recipientKind: "user",
            recipientId: input.userId,
            recipientKeyEpochId: `user:${input.userId}:epoch-1`,
            recipientKeyFingerprint: recipient.keyFingerprint,
            kemCipherText: bytesToBase64(recipient.kemCipherText),
            wrappedKey: bytesToBase64(recipient.wrappedKey),
            wrapManifestHash: manifestHash,
          },
        ],
      },
    ],
  };
}

async function createExplorerMetadataV2CreateResponse(
  request: DocumentV2CreateRequest,
): Promise<DocumentV2CreateResponse> {
  const manifest = request.manifest as Record<string, unknown>;
  const body = request.body as Record<string, unknown>;
  const documentId = String(Reflect.get(manifest, "objectId"));
  const eventHash = await computeAccessEventHash(
    request.event as unknown as AccessEventV2,
  );
  const linkedContainerId = String(Reflect.get(body, "containerId"));
  const targets = request.contentKeyBundle.targets.map((target) => ({
    containerId: target.containerId,
    containerManifestHash: target.containerManifestHash,
    containerKeyEpochId: target.containerKeyEpochId,
    containerKeyEpoch: target.containerKeyEpoch,
  }));

  return {
    id: documentId,
    createdAt: "2026-04-27T00:00:00.000Z",
    accessManifest: {
      event: { event: request.event, body, eventHash },
      manifest,
      manifestHash: request.expectedManifestHash,
      state: {
        version: 2,
        documentId,
        organizationId: String(Reflect.get(manifest, "organizationId")),
        epoch: Number(Reflect.get(manifest, "epoch")),
        previousManifestHash: Reflect.get(manifest, "previousManifestHash"),
        eventHash,
        linkedContainerIds: [linkedContainerId],
      },
    },
    contentKeyBundle: {
      documentId,
      contentKeyEpoch: request.contentKeyBundle.contentKeyEpoch,
      linkSetManifestHash: request.contentKeyBundle.linkSetManifestHash,
      targetHash: request.contentKeyBundle.targetHash,
      targets: request.contentKeyBundle.targets,
    },
    documentKekTargets: {
      documentId,
      linkSetManifestHash: request.expectedManifestHash,
      linkedContainerManifestHashes: targets.map(
        (target) => target.containerManifestHash,
      ),
      linkedContainerKeyEpochIds: targets.map(
        (target) => target.containerKeyEpochId,
      ),
      targets,
      documentKeyTargetHash: request.contentKeyBundle.targetHash,
    },
  };
}

async function createExplorerMetadataV2SyncResponse(input: {
  commitLsn: string;
  request: DocumentV2SyncRequest;
  storedDocument: DocumentV2CreateResponse;
}): Promise<DocumentV2SyncResponse> {
  const updates = await Promise.all(
    input.request.outgoingUpdates.map(async (update) => {
      const writeHeader = update.writeHeader as unknown as WriteHeaderV2;
      return {
        accessEpoch: 1,
        id: update.id,
        documentId: input.storedDocument.id,
        authorFingerprint: writeHeader.writerKeyFingerprint,
        encryptedData: update.encryptedData,
        partialStartVersionVector: update.partialStartVersionVector,
        partialEndVersionVector: update.partialEndVersionVector,
        createdAt: "2026-04-27T00:00:00.000Z",
        writeHeader: update.writeHeader,
        writeHeaderHash: await computeWriteHeaderHash(writeHeader),
      };
    }),
  );

  return {
    acceptedOutgoingUpdateIds: input.request.outgoingUpdates.map(
      (update) => update.id,
    ),
    commitLsn: input.commitLsn,
    contentKeyBundle: input.storedDocument.contentKeyBundle,
    documentId: input.storedDocument.id,
    documentKekTargets: input.storedDocument.documentKekTargets,
    missingUpdateEpochs: updates.length === 0 ? [] : ["current_epoch"],
    updates,
  };
}

async function createExplorerMetadataV2Fixture(input: {
  containerId: string;
  documentId: string;
  encapsulationKeyPair: NonNullable<TestRuntime["encapsulationKeyPair"]>;
  execSql: TestRuntime["execSql"];
  organizationId?: string;
  syncCalls?: Array<{ minLsn: string | null; outgoingUpdateCount: number }>;
}) {
  const organizationId = input.organizationId ?? "org-1";
  const userId = "user-1";
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const signingFingerprint = await toFingerprint(
    signingKeyPair.signingPublicKey,
  );
  const containerProjection = await createExplorerMetadataV2ContainerProjection(
    {
      containerId: input.containerId,
      encapsulationPublicKey: input.encapsulationKeyPair.publicKey,
      organizationId,
      userId,
    },
  );
  const materializedPlan = await buildMaterializedDocumentV2CreatePlan({
    author: {
      organizationId,
      signerDeviceId: `signing-key:${signingFingerprint}`,
      signerKeyFingerprint: signingFingerprint,
      signerPrivateKey: signingKeyPair.signingPrivateKey,
      signerUserId: userId,
    },
    containerProjection,
    documentId: input.documentId,
    execSql: input.execSql,
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: input.encapsulationKeyPair.secretKey,
  });
  const storedDocument = await createExplorerMetadataV2CreateResponse(
    materializedPlan.plan.request,
  );
  let syncCallCount = 0;
  const writerProjection: DocumentV2WriterProjectionResponse = {
    authorizingContainerPaths: [containerProjection],
    contentKeyBundle: storedDocument.contentKeyBundle,
    documentId: storedDocument.id,
    documentKekTargets: storedDocument.documentKekTargets,
    documentManifest: storedDocument.accessManifest,
  };

  return {
    apiClient: {
      getEncapsulationKey: async (requestedUserId: string) => {
        if (requestedUserId !== userId) {
          return null;
        }

        return {
          encapsulationPublicKey: bytesToBase64(
            input.encapsulationKeyPair.publicKey,
          ),
          signingKeyFingerprint: signingFingerprint,
          signingPublicKey: bytesToBase64(signingKeyPair.signingPublicKey),
          userId,
        };
      },
      getDocumentV2WriterProjection: async (documentId: string) =>
        documentId === storedDocument.id ? writerProjection : null,
      syncDocumentV2: async (
        documentId: string,
        request: DocumentV2SyncRequest,
      ) => {
        if (documentId !== storedDocument.id) {
          return null;
        }

        syncCallCount += 1;
        input.syncCalls?.push({
          minLsn: request.minLsn ?? null,
          outgoingUpdateCount: request.outgoingUpdates.length,
        });

        return createExplorerMetadataV2SyncResponse({
          commitLsn: syncCallCount === 1 ? "0/10" : "0/20",
          request,
          storedDocument,
        });
      },
    },
    organizationId,
    persistedState: persistedDocumentV2CreateStateFromResponse(
      materializedPlan.plan,
      storedDocument,
    ),
    signingFingerprint,
    signingKeyPair,
    userId,
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
        _expectedAccessStateHash: string,
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
      getEncapsulationKey: async () => null,
      getDocumentV2WriterProjection: async () => null,
      syncDocumentV2: async () => null,
    },
  };
}

test("explorer store creates, renames, deletes, and reloads child containers", async () => {
  const runtime = await createSqlRuntime();

  try {
    await ensureContainerTables(runtime.execSql);
    await ensureDocumentTables(runtime.execSql);
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
        metadataAccessStateHash: "container-a-access-state-hash-1",
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
        metadataAccessStateHash: "container-b-access-state-hash-1",
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
    expectedAccessStateHash: string;
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
      expectedAccessStateHash: string,
      initialMetadataUpdates,
    ) => {
      createContainerCalls.push({
        expectedAccessStateHash,
        id,
        initialMetadataUpdateCount: initialMetadataUpdates.length,
        parentId,
      });
      return {
        id,
        metadataAccessEpoch: 1,
        metadataAccessStateHash: "metadata-access-state-hash-1",
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
  };
  try {
    await ensureContainerTables(runtime.execSql);
    await ensureDocumentTables(runtime.execSql);
    const { initialUpdate: rootInitialUpdate } =
      await createInitializedContainerMetadataDocument("root-container", {
        icon: null,
        name: "/",
      });
    await saveContainer(runtime.execSql, {
      id: "root-container",
      organizationId: "org-1",
      parentId: null,
      metadataDocumentId: "root-metadata-document",
      name: "/",
      icon: null,
    });
    await saveDocumentRecord(
      runtime.execSql,
      {
        appKind: "container-metadata",
        localId: "root-container",
      },
      {
        accessEpoch: 1,
        accessStateHash: "root-access-state-hash-1",
        documentId: "root-metadata-document",
        documentRecipientEnvelopes: null,
        id: "root-container",
        lastCommitLsn: null,
        loroSnapshot: bytesToBase64(rootInitialUpdate),
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

    expect(createContainerCalls).toEqual([
      {
        expectedAccessStateHash: "root-access-state-hash-1",
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

test("explorer store queues authenticated child create when parent has no remote access state", async () => {
  const runtime = await createSqlRuntime();
  const localKeyPair = generateKemSeedAndKeyPair();
  let createContainerCallCount = 0;
  let store: ReturnType<typeof createExplorerStore> | null = null;

  runtime.isAuthenticated = true;
  runtime.online = true;
  runtime.encapsulationKeyPair = localKeyPair;
  runtime.apiClient = {
    ...runtime.apiClient,
    createContainer: async () => {
      createContainerCallCount += 1;
      return null;
    },
    listContainers: async () => [],
  };

  try {
    await ensureContainerTables(runtime.execSql);
    await ensureDocumentTables(runtime.execSql);
    await saveContainer(runtime.execSql, {
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

    expect(createContainerCallCount).toBe(0);
    expect(childNode.parentId).toBe("root-container");
    expect(childNode.name).toBe("Docs");

    const pendingIntents =
      await sqlExplorerPersistence.listPendingCreateIntents(runtime.execSql);
    expect(pendingIntents).toEqual([
      expect.objectContaining({
        containerId: childNode.id,
        parentContainerId: "root-container",
        syncStatus: "pending",
      }),
    ]);

    const pendingUpdateRows = await runtime.execSql(
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
      runtime.dbStatus = "terminated";
      store.updateRuntime(runtime);
    }
    runtime.close();
  }
});

test("explorer sync creates queued local containers parent before child", async () => {
  const runtime = await createSqlRuntime();
  const localKeyPair = generateKemSeedAndKeyPair();
  let store: ReturnType<typeof createExplorerStore> | null = null;

  try {
    await ensureContainerTables(runtime.execSql);
    await ensureDocumentTables(runtime.execSql);
    const { initialUpdate: rootInitialUpdate } =
      await createInitializedContainerMetadataDocument("root-container", {
        icon: null,
        name: "/",
      });
    await saveContainer(runtime.execSql, {
      id: "root-container",
      organizationId: "org-1",
      parentId: null,
      metadataDocumentId: "root-metadata-document",
      name: "/",
      icon: null,
    });
    await saveDocumentRecord(
      runtime.execSql,
      {
        appKind: "container-metadata",
        localId: "root-container",
      },
      {
        accessEpoch: 1,
        accessStateHash: "stale-root-access-state-hash",
        documentId: "root-metadata-document",
        documentRecipientEnvelopes: null,
        id: "root-container",
        lastCommitLsn: null,
        loroSnapshot: bytesToBase64(rootInitialUpdate),
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

    const createContainerCalls: Array<{
      expectedAccessStateHash: string;
      id: string;
      initialMetadataRecipientEnvelopeCount: number;
      initialMetadataUpdateCount: number;
      parentId: string;
    }> = [];
    const remoteContainers = new Map<string, ListedContainer>([
      [
        "root-container",
        {
          id: "root-container",
          metadataAccessEpoch: 2,
          metadataAccessStateHash: "current-root-access-state-hash",
          metadataDocumentId: "root-metadata-document",
          metadataRecipientEncapsulationPublicKeys: [
            bytesToBase64(localKeyPair.publicKey),
          ],
          organizationId: "org-1",
          parentId: null,
        },
      ],
    ]);
    const authenticatedRuntime: TestRuntime = {
      ...runtime,
      encapsulationKeyPair: localKeyPair,
      isAuthenticated: true,
      online: true,
      apiClient: {
        ...runtime.apiClient,
        createContainer: async (
          id,
          parentId,
          expectedAccessStateHash,
          initialMetadataUpdates,
          initialMetadataRecipientEnvelopes,
        ) => {
          createContainerCalls.push({
            expectedAccessStateHash,
            id,
            initialMetadataRecipientEnvelopeCount:
              initialMetadataRecipientEnvelopes?.length ?? 0,
            initialMetadataUpdateCount: initialMetadataUpdates.length,
            parentId,
          });
          const created = {
            id,
            metadataAccessEpoch: 1,
            metadataAccessStateHash: `access-state-hash-${id}`,
            metadataDocumentId: `metadata-document-${id}`,
            metadataRecipientEncapsulationPublicKeys: [
              bytesToBase64(localKeyPair.publicKey),
            ],
            organizationId: "org-1",
            parentId,
          };
          remoteContainers.set(id, created);
          return created;
        },
        listContainers: async () => Array.from(remoteContainers.values()),
      },
    };

    createdStore.updateRuntime(authenticatedRuntime);

    await waitForCondition(
      () => createContainerCalls.length === 3,
      `Queued local containers were not synced.\ncreateContainerCalls=${JSON.stringify(
        createContainerCalls,
      )}`,
    );

    expect(createContainerCalls).toEqual([
      {
        expectedAccessStateHash: "current-root-access-state-hash",
        id: parentNode.id,
        initialMetadataRecipientEnvelopeCount: 1,
        initialMetadataUpdateCount: 1,
        parentId: "root-container",
      },
      {
        expectedAccessStateHash: `access-state-hash-${parentNode.id}`,
        id: childNode.id,
        initialMetadataRecipientEnvelopeCount: 1,
        initialMetadataUpdateCount: 1,
        parentId: parentNode.id,
      },
      {
        expectedAccessStateHash: `access-state-hash-${childNode.id}`,
        id: grandchildNode.id,
        initialMetadataRecipientEnvelopeCount: 1,
        initialMetadataUpdateCount: 1,
        parentId: childNode.id,
      },
    ]);
    expect(
      await sqlExplorerPersistence.listPendingCreateIntents(runtime.execSql),
    ).toEqual([]);

    const persistedContainers = await loadContainers(runtime.execSql);
    expect(
      persistedContainers.find((container) => container.id === parentNode.id)
        ?.metadataDocumentId,
    ).toBe(`metadata-document-${parentNode.id}`);
    expect(
      persistedContainers.find((container) => container.id === childNode.id)
        ?.metadataDocumentId,
    ).toBe(`metadata-document-${childNode.id}`);
    expect(
      persistedContainers.find(
        (container) => container.id === grandchildNode.id,
      )?.metadataDocumentId,
    ).toBe(`metadata-document-${grandchildNode.id}`);
  } finally {
    if (store) {
      runtime.dbStatus = "terminated";
      store.updateRuntime(runtime);
    }
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
    expectedAccessStateHash: string;
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
      expectedAccessStateHash: string,
      _initialMetadataUpdates,
      initialMetadataRecipientEnvelopes,
    ) => {
      createContainerCalls.push({
        expectedAccessStateHash,
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
        metadataAccessStateHash: "metadata-access-state-hash-2",
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
        metadataAccessStateHash: "shared-root-access-state-hash-1",
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
        expectedAccessStateHash: "shared-root-access-state-hash-1",
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
    expectedAccessStateHash: string;
    parentId: string;
  }> = [];
  let remoteContainers = [
    {
      id: "root-container",
      metadataAccessEpoch: 1,
      metadataAccessStateHash: "root-access-state-hash-1",
      metadataDocumentId: "root-metadata-document",
      metadataRecipientEncapsulationPublicKeys: recipientPublicKeys,
      organizationId: "org-1",
      parentId: null,
    },
    {
      id: "parent-a",
      metadataAccessEpoch: 1,
      metadataAccessStateHash: "parent-a-access-state-hash-1",
      metadataDocumentId: "parent-a-metadata-document",
      metadataRecipientEncapsulationPublicKeys: recipientPublicKeys,
      organizationId: "org-1",
      parentId: "root-container",
    },
    {
      id: "parent-b",
      metadataAccessEpoch: 1,
      metadataAccessStateHash: "parent-b-access-state-hash-1",
      metadataDocumentId: "parent-b-metadata-document",
      metadataRecipientEncapsulationPublicKeys: recipientPublicKeys,
      organizationId: "org-1",
      parentId: "root-container",
    },
    {
      id: "child-container",
      metadataAccessEpoch: 1,
      metadataAccessStateHash: "child-access-state-hash-1",
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
    moveContainer: async (containerId, parentId, expectedAccessStateHash) => {
      moveContainerCalls.push({
        containerId,
        expectedAccessStateHash,
        parentId,
      });
      remoteContainers = remoteContainers.map((container) =>
        container.id === containerId
          ? {
              ...container,
              metadataAccessEpoch: container.metadataAccessEpoch + 1,
              metadataAccessStateHash: "child-access-state-hash-2",
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
      {
        containerId: "child-container",
        expectedAccessStateHash: "child-access-state-hash-1",
        parentId: "parent-b",
      },
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

test("explorer store shares an authenticated container without reseeding legacy metadata envelopes", async () => {
  const runtime = await createSqlRuntime();
  const localKeyPair = generateKemSeedAndKeyPair();
  const peerKeyPair = generateKemSeedAndKeyPair();
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const signingFingerprint = await toFingerprint(
    signingKeyPair.signingPublicKey,
  );
  const shareContainerCalls: Array<{
    accessLevel: "read" | "write" | "admin";
    containerId: string;
    expectedAccessStateHash: string;
    subjectId: string;
    subjectType: "user" | "group" | "organization";
  }> = [];
  let writerProjectionCallCount = 0;
  let v2SyncCallCount = 0;

  runtime.isAuthenticated = true;
  runtime.online = true;
  runtime.encapsulationKeyPair = localKeyPair;
  runtime.organizationId = "org-1";
  runtime.signingFingerprint = signingFingerprint;
  runtime.signingKeyPair = signingKeyPair;
  runtime.userId = "user-1";
  runtime.apiClient = {
    ...runtime.apiClient,
    createContainer: async () => null,
    getDocumentV2WriterProjection: async () => {
      writerProjectionCallCount += 1;
      return null;
    },
    listContainers: async () => [],
    shareContainer: async (
      containerId: string,
      subjectType: "user" | "group" | "organization",
      subjectId: string,
      accessLevel: "read" | "write" | "admin",
      expectedAccessStateHash: string,
    ) => {
      shareContainerCalls.push({
        accessLevel,
        containerId,
        expectedAccessStateHash,
        subjectId,
        subjectType,
      });
      return {
        id: containerId,
        metadataAccessEpoch: 2,
        metadataAccessStateHash: "access-state-hash-2",
        metadataDocumentId: "metadata-document-1",
        metadataRecipientEncapsulationPublicKeys: [
          bytesToBase64(localKeyPair.publicKey),
          bytesToBase64(peerKeyPair.publicKey),
        ],
      };
    },
    syncDocumentV2: async () => {
      v2SyncCallCount += 1;
      return null;
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
      metadataDocumentId: null,
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
        accessStateHash: "access-state-hash-1",
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

    writerProjectionCallCount = 0;
    v2SyncCallCount = 0;
    const shared = await createdStore.shareWithUser(
      "child-container",
      "550e8400-e29b-41d4-a716-446655440000",
    );

    expect(shared).toBe(true);

    await waitForCondition(async () => {
      const rows = await runtime.execSql(
        `
          SELECT document_recipient_envelopes AS envelopes
          FROM documents
          WHERE app_kind = 'container-metadata'
            AND local_id = 'child-container'
        `,
      );
      return (
        writerProjectionCallCount > 0 &&
        readSqlRowValue(rows[0] ?? {}, "envelopes") === null
      );
    }, "Explorer store did not clear legacy metadata envelopes after share.");

    expect(v2SyncCallCount).toBe(0);
    expect(
      createdStore
        .getSnapshot()
        .nodes.some(
          (node) =>
            node.id === "child-container" && node.organizationId === "org-1",
        ),
    ).toBe(true);

    expect(shareContainerCalls).toEqual([
      {
        accessLevel: "write",
        containerId: "child-container",
        expectedAccessStateHash: "access-state-hash-1",
        subjectId: "550e8400-e29b-41d4-a716-446655440000",
        subjectType: "user",
      },
    ]);
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
  let store: ReturnType<typeof createExplorerStore> | null = null;
  const v2Fixture = await createExplorerMetadataV2Fixture({
    containerId: "child-container",
    documentId: "metadata-document-1",
    encapsulationKeyPair: localKeyPair,
    execSql: runtime.execSql,
    syncCalls,
  });

  runtime.isAuthenticated = true;
  runtime.online = true;
  runtime.encapsulationKeyPair = localKeyPair;
  runtime.organizationId = v2Fixture.organizationId;
  runtime.signingFingerprint = v2Fixture.signingFingerprint;
  runtime.signingKeyPair = v2Fixture.signingKeyPair;
  runtime.userId = v2Fixture.userId;
  runtime.apiClient = {
    ...runtime.apiClient,
    ...v2Fixture.apiClient,
    createContainer: async () => null,
    listContainers: async () => [],
  };

  try {
    await ensureContainerTables(runtime.execSql);
    await ensureDocumentTables(runtime.execSql);
    await saveContainer(runtime.execSql, {
      id: "root-container",
      organizationId: "org-1",
      parentId: null,
      metadataDocumentId: null,
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
    await saveDocumentRecord(
      runtime.execSql,
      {
        appKind: "container-metadata",
        localId: "child-container",
      },
      {
        ...v2Fixture.persistedState,
        accessEpoch: 1,
        accessStateHash: "metadata-access-state-hash-1",
        documentId: "metadata-document-1",
        documentRecipientEnvelopes: null,
        id: "child-container",
        lastCommitLsn: null,
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
        syncCalls.some(
          (call) => call.minLsn === "0/10" && call.outgoingUpdateCount === 1,
        ) && pendingCount === 0
      );
    }, "Follow-up metadata sync did not complete.");

    const documentRows = await runtime.execSql(
      `
        SELECT
          last_commit_lsn,
          v2_content_key_bundle,
          v2_document_kek_targets,
          v2_document_manifest_bundle
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
      readSqlRowValue(documentRows[0] ?? {}, "v2_content_key_bundle"),
    ).toBeString();
    expect(
      readSqlRowValue(documentRows[0] ?? {}, "v2_document_kek_targets"),
    ).toBeString();
    expect(
      readSqlRowValue(documentRows[0] ?? {}, "v2_document_manifest_bundle"),
    ).toBeString();
  } finally {
    if (store) {
      runtime.dbStatus = "terminated";
      store.updateRuntime(runtime);
    }
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
          metadataAccessStateHash: "shared-root-access-state-hash-1",
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

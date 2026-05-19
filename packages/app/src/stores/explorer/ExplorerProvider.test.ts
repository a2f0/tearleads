import { expect, test } from "bun:test";
import {
  createDocumentSignerDeviceId,
  type ExecSql,
} from "@tearleads/client-sdk";
import { createInitializedContainerMetadataDocument } from "@tearleads/client-sdk/data/containers/containerMetadataDocument";
import {
  ensureContainerTables,
  loadContainers,
  saveContainer,
} from "@tearleads/client-sdk/data/persistence/containers/containerPersistence";
import {
  containerDocumentsSyncLane,
  containerParentSyncLane,
  sqlContainerSyncWatermarkPersistence,
} from "@tearleads/client-sdk/data/persistence/containers/containerSyncWatermarkPersistence";
import { sqlDocumentContainerProjectionPersistence } from "@tearleads/client-sdk/data/persistence/containers/documentContainerProjectionPersistence";
import { sqlDocumentsPersistence } from "@tearleads/client-sdk/data/persistence/documents/documentsPersistence";
import { sqlExplorerPersistence } from "@tearleads/client-sdk/data/persistence/explorer/explorerPersistence";
import {
  ensureDocumentTables,
  saveDocumentRecord,
} from "@tearleads/client-sdk/data/sqlite/documentPersistence";
import {
  buildMaterializedDocumentCreatePlan,
  persistedDocumentCreateStateFromResponse,
} from "@tearleads/client-sdk/workflows/documents";
import { createExplorerWorkflowRuntime } from "@tearleads/client-sdk/workflows/explorer";
import {
  type ContainerKekRecipientTarget,
  computeAccessEventHash,
  computeContainerKekRecipientTargetHash,
  computeContainerKeyEpochHash,
  computeWriteHeaderHash,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import type {
  ContainerMutationRequest,
  DocumentCreateRequest,
  DocumentSyncRequest,
} from "@tearleads/validators/request";
import type {
  AccessManifestBundleWireResponse,
  ContainerMutationResponse,
  ContainerSummary,
  ContainerWriterProjectionResponse,
  DocumentCreateResponse,
  DocumentSyncResponse,
  DocumentWriterProjectionResponse,
  ListContainersResponse,
  ReferencedPrincipalStateResponse,
} from "@tearleads/validators/response";
import { isAccessManifestBundleWireResponse } from "@tearleads/validators/util";
import { createContainerWriterProjectionFixture } from "../../../test/helpers/createContainerWriterProjectionFixture";
import { createMockApiClient } from "../../../test/helpers/createMockApiClient";
import { createSqlRuntimeBase } from "../../../test/helpers/createSqlRuntime";
import {
  assertAccessEvent,
  assertContainerKeyEpoch,
  assertWriteHeader,
} from "../../../test/helpers/keyingAssertions";
import { waitForCondition } from "../../../test/helpers/waitForCondition";
import { createExplorerStore } from "./ExplorerProvider";
import {
  createExplorerSyncAgent,
  type ExplorerSyncState,
} from "./explorerSyncAgent";
import {
  createExplorerStoreState,
  subscribeToExplorerStore,
  updateExplorerSnapshot,
} from "./state";

type ExplorerRuntime = Parameters<typeof createExplorerStore>[0];
type TestRuntime = ExplorerRuntime & { close: () => void; execSql: ExecSql };
type ListedContainer = ContainerSummary;
const TEST_SYNC_TIMESTAMP = "2026-05-05T00:00:00.000Z";

function listedContainer(
  overrides: Omit<ContainerSummary, "createdAt" | "depth" | "updatedAt"> &
    Partial<Pick<ContainerSummary, "createdAt" | "depth" | "updatedAt">>,
): ContainerSummary {
  return {
    createdAt: TEST_SYNC_TIMESTAMP,
    depth: overrides.parentId === null ? 0 : 1,
    updatedAt: TEST_SYNC_TIMESTAMP,
    ...overrides,
  };
}

function listContainersResponse(
  items: ReadonlyArray<ContainerSummary> = [],
): ListContainersResponse {
  const lastItem = items.at(-1);
  return {
    hasMore: false,
    items: [...items],
    nextWatermark: lastItem
      ? { id: lastItem.id, updatedAt: lastItem.updatedAt }
      : null,
    tombstones: [],
  };
}

function readSqlRowValue(
  row: Record<string, string | number | null>,
  key: string,
): string | number | null | undefined {
  return row[key];
}

async function createExplorerMetadataContainerProjection(input: {
  containerId: string;
  encapsulationPublicKey: Uint8Array;
  organizationId: string;
  parentProjection?: ContainerWriterProjectionResponse;
  signerKeyFingerprint: string;
  signerPrivateKey: Uint8Array;
  userId: string;
}): Promise<ContainerWriterProjectionResponse> {
  return createContainerWriterProjectionFixture({
    containerId: input.containerId,
    encapsulationPublicKey: input.encapsulationPublicKey,
    metadataDocumentId: `${input.containerId}-metadata-document`,
    organizationId: input.organizationId,
    parentProjection: input.parentProjection,
    signerKeyFingerprint: input.signerKeyFingerprint,
    signerPrivateKey: input.signerPrivateKey,
    userId: input.userId,
  });
}

async function createExplorerMetadataCreateResponse(
  request: DocumentCreateRequest,
): Promise<DocumentCreateResponse> {
  const manifest = request.manifest as Record<string, unknown>;
  const body = request.body as Record<string, unknown>;
  const documentId = String(Reflect.get(manifest, "objectId"));
  const event = assertAccessEvent(request.event, "metadata document event");
  const eventHash = await computeAccessEventHash(event);
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
      event: { event: { ...event }, body, eventHash },
      manifest,
      manifestHash: request.expectedManifestHash,
      state: {
        version: 1,
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

async function createExplorerMetadataSyncResponse(input: {
  commitLsn: string;
  request: DocumentSyncRequest;
  storedDocument: DocumentCreateResponse;
}): Promise<DocumentSyncResponse> {
  const updates = await Promise.all(
    input.request.outgoingUpdates.map(async (update) => {
      const writeHeader = assertWriteHeader(
        update.writeHeader,
        "metadata sync write header",
      );
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

function readRequestString(
  record: Record<string, unknown>,
  key: string,
): string {
  const value = Reflect.get(record, key);
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Expected ${key} to be a non-empty string.`);
  }

  return value;
}

async function createExplorerContainerMutationResponse(
  request: ContainerMutationRequest,
): Promise<ContainerMutationResponse> {
  const body = request.body as Record<string, unknown>;
  const manifest = request.manifest as Record<string, unknown>;
  const keyEpoch = assertContainerKeyEpoch(
    request.keyEpoch,
    "container mutation key epoch",
  );
  const event = assertAccessEvent(request.event, "container mutation event");
  const eventHash = await computeAccessEventHash(event);
  const previousState = request.previousManifest?.state ?? null;
  const containerId = readRequestString(manifest, "objectId");
  const organizationId = readRequestString(manifest, "organizationId");
  const parentIdValue = Reflect.get(body, "parentContainerId");
  const parentId =
    typeof parentIdValue === "string"
      ? parentIdValue
      : previousState &&
          typeof Reflect.get(previousState, "parentContainerId") === "string"
        ? (Reflect.get(previousState, "parentContainerId") as string)
        : null;
  const metadataDocumentIdValue = Reflect.get(body, "metadataDocumentId");
  const metadataDocumentId =
    typeof metadataDocumentIdValue === "string"
      ? metadataDocumentIdValue
      : previousState &&
          typeof Reflect.get(previousState, "metadataDocumentId") === "string"
        ? (Reflect.get(previousState, "metadataDocumentId") as string)
        : `${containerId}-metadata-document`;
  const containerKeyEpochId = readRequestString(body, "containerKeyEpochId");
  const previousDirectGrants = previousState
    ? Reflect.get(previousState, "directGrants")
    : undefined;
  const directGrants = Array.isArray(previousDirectGrants)
    ? [...previousDirectGrants]
    : [];
  const eventType = Reflect.get(body, "eventType");
  if (eventType === "container.grant") {
    directGrants.push(Reflect.get(body, "grant"));
  }
  const recipientTargets: ContainerKekRecipientTarget[] = request.wraps.map(
    (wrap) => ({
      recipientKind: Reflect.get(wrap, "recipientKind"),
      recipientId: Reflect.get(wrap, "recipientId"),
      recipientKeyEpochId: Reflect.get(wrap, "recipientKeyEpochId"),
      recipientKeyFingerprint: Reflect.get(wrap, "recipientKeyFingerprint"),
    }),
  ) as ContainerKekRecipientTarget[];
  const previousManifest =
    request.previousManifest &&
    typeof request.previousManifest === "object" &&
    "manifestHash" in request.previousManifest
      ? request.previousManifest
      : null;
  const previousManifestResponse = previousManifest
    ? requireAccessManifestBundleWireResponse(previousManifest)
    : null;

  return {
    containerId,
    createdAt: "2026-05-05T00:00:00.000Z",
    organizationId,
    parentId,
    updatedAt: "2026-05-05T00:00:01.000Z",
    manifestHead: {
      epoch: Number(Reflect.get(manifest, "epoch")),
      manifestHash: request.expectedManifestHash,
    },
    accessManifest: {
      event: { event: { ...event }, body, eventHash },
      manifest,
      manifestHash: request.expectedManifestHash,
      state: {
        version: 1,
        containerId,
        organizationId,
        epoch: Number(Reflect.get(manifest, "epoch")),
        previousManifestHash: Reflect.get(manifest, "previousManifestHash"),
        eventHash,
        parentContainerId: parentId,
        parentManifestHash:
          Reflect.get(body, "parentManifestHash") ??
          (previousState
            ? Reflect.get(previousState, "parentManifestHash")
            : null),
        metadataDocumentId,
        containerKeyEpochId,
        directGrants,
        referencedPrincipalHeads: [],
      },
    },
    containerKek: {
      containerId,
      accessManifestHash: request.expectedManifestHash,
      containerKeyEpochId,
      containerKeyEpoch: keyEpoch.keyEpoch,
      keyEpoch: request.keyEpoch,
      keyEpochHash: await computeContainerKeyEpochHash(keyEpoch),
      keyTargetHash:
        await computeContainerKekRecipientTargetHash(recipientTargets),
      parentContainerKeyEpochId: keyEpoch.parentContainerKeyEpochId,
      ...(previousManifestResponse
        ? { containerManifestHistory: [previousManifestResponse] }
        : {}),
      recipientTargets: recipientTargets as unknown as Record<
        string,
        unknown
      >[],
      wraps: request.wraps,
    },
    referencedPrincipalHeads: [],
  };
}

function requireAccessManifestBundleWireResponse(
  value: unknown,
): AccessManifestBundleWireResponse {
  if (!isAccessManifestBundleWireResponse(value)) {
    throw new Error("Expected previous manifest response bundle");
  }
  return value;
}

function createExplorerContainerApiHarness(
  initialProjections: readonly ContainerWriterProjectionResponse[],
) {
  const projections = new Map(
    initialProjections.map((projection) => [
      projection.containerId,
      projection,
    ]),
  );
  const containerCreateCalls: Array<{
    containerId: string;
    metadataDocumentId: string;
    parentId: string;
    wrapRecipientKinds: string[];
  }> = [];
  const documentCreateCalls: Array<{
    containerId: string;
    documentId: string;
  }> = [];
  const containerShareCalls: Array<{
    accessLevel: unknown;
    containerId: string;
    subjectId: unknown;
    wrapRecipientKinds: string[];
  }> = [];
  const containerMoveCalls: Array<{
    containerId: string;
    parentId: string | null;
    wrapRecipientKinds: string[];
  }> = [];

  return {
    apiClient: createMockApiClient({
      createContainer: async (request: ContainerMutationRequest) => {
        const response = await createExplorerContainerMutationResponse(request);
        const parentProjection = projections.get(response.parentId ?? "");
        if (!parentProjection) {
          return null;
        }

        projections.set(response.containerId, {
          containerId: response.containerId,
          organizationId: response.organizationId,
          path: [...parentProjection.path, response.accessManifest],
          containerKeks: [
            ...parentProjection.containerKeks,
            response.containerKek,
          ],
        });
        containerCreateCalls.push({
          containerId: response.containerId,
          metadataDocumentId: readRequestString(
            request.body as Record<string, unknown>,
            "metadataDocumentId",
          ),
          parentId: response.parentId ?? "",
          wrapRecipientKinds: request.wraps
            .map((wrap) => Reflect.get(wrap, "recipientKind"))
            .filter((kind): kind is string => typeof kind === "string")
            .sort(),
        });
        return response;
      },
      createDocument: async (request: DocumentCreateRequest) => {
        const response = await createExplorerMetadataCreateResponse(request);
        documentCreateCalls.push({
          containerId: readRequestString(
            request.body as Record<string, unknown>,
            "containerId",
          ),
          documentId: response.id,
        });
        return response;
      },
      getContainerWriterProjection: async (containerId: string) =>
        projections.get(containerId) ?? null,
      shareContainer: async (
        containerId: string,
        request: ContainerMutationRequest,
      ) => {
        const response = await createExplorerContainerMutationResponse(request);
        const previousProjection = projections.get(containerId);
        if (!previousProjection) {
          return null;
        }

        projections.set(containerId, {
          containerId,
          organizationId: response.organizationId,
          path: [
            ...previousProjection.path.slice(0, -1),
            response.accessManifest,
          ],
          containerKeks: [
            ...previousProjection.containerKeks.slice(0, -1),
            response.containerKek,
          ],
        });
        const body = request.body as Record<string, unknown>;
        const grant = Reflect.get(body, "grant") as
          | Record<string, unknown>
          | undefined;
        containerShareCalls.push({
          accessLevel: grant ? Reflect.get(grant, "accessLevel") : undefined,
          containerId,
          subjectId: grant ? Reflect.get(grant, "subjectId") : undefined,
          wrapRecipientKinds: request.wraps
            .map((wrap) => Reflect.get(wrap, "recipientKind"))
            .filter((kind): kind is string => typeof kind === "string")
            .sort(),
        });
        return response;
      },
      moveContainer: async (
        containerId: string,
        request: ContainerMutationRequest,
      ) => {
        const response = await createExplorerContainerMutationResponse(request);
        const destinationProjection = response.parentId
          ? projections.get(response.parentId)
          : null;
        if (!destinationProjection) {
          return null;
        }

        projections.set(containerId, {
          containerId,
          organizationId: response.organizationId,
          path: [...destinationProjection.path, response.accessManifest],
          containerKeks: [
            ...destinationProjection.containerKeks,
            response.containerKek,
          ],
        });
        containerMoveCalls.push({
          containerId,
          parentId: response.parentId,
          wrapRecipientKinds: request.wraps
            .map((wrap) => Reflect.get(wrap, "recipientKind"))
            .filter((kind): kind is string => typeof kind === "string")
            .sort(),
        });
        return response;
      },
    }),
    containerCreateCalls,
    documentCreateCalls,
    containerMoveCalls,
    containerShareCalls,
    projections,
  };
}

async function createExplorerMetadataFixture(input: {
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
  const containerProjection = await createExplorerMetadataContainerProjection({
    containerId: input.containerId,
    encapsulationPublicKey: input.encapsulationKeyPair.publicKey,
    organizationId,
    signerKeyFingerprint: signingFingerprint,
    signerPrivateKey: signingKeyPair.signingPrivateKey,
    userId,
  });
  const materializedPlan = await buildMaterializedDocumentCreatePlan({
    author: {
      organizationId,
      signerDeviceId: createDocumentSignerDeviceId(signingFingerprint),
      signerKeyFingerprint: signingFingerprint,
      signerPrivateKey: signingKeyPair.signingPrivateKey,
      signerUserId: userId,
    },
    containerProjection,
    documentId: input.documentId,
    execSql: input.execSql,
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: input.encapsulationKeyPair.secretKey,
    trustedLocalProjection: true,
  });
  const storedDocument = await createExplorerMetadataCreateResponse(
    materializedPlan.plan.request,
  );
  let syncCallCount = 0;
  const writerProjection: DocumentWriterProjectionResponse = {
    authorizingContainerPaths: [containerProjection],
    contentKeyBundle: storedDocument.contentKeyBundle,
    documentId: storedDocument.id,
    documentKekTargets: storedDocument.documentKekTargets,
    documentManifest: storedDocument.accessManifest,
  };

  return {
    apiClient: createMockApiClient({
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
      getDocumentWriterProjection: async (documentId: string) =>
        documentId === storedDocument.id ? writerProjection : null,
      syncDocument: async (
        documentId: string,
        request: DocumentSyncRequest,
      ) => {
        if (documentId !== storedDocument.id) {
          return null;
        }

        syncCallCount += 1;
        input.syncCalls?.push({
          minLsn: request.minLsn ?? null,
          outgoingUpdateCount: request.outgoingUpdates.length,
        });

        return createExplorerMetadataSyncResponse({
          commitLsn: syncCallCount === 1 ? "0/10" : "0/20",
          request,
          storedDocument,
        });
      },
    }),
    organizationId,
    persistedState: persistedDocumentCreateStateFromResponse(
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
  const input = {
    ...runtimeBase,
    apiClient: createMockApiClient({
      bindBlobAttachment: async () => null,
      createContainer: async () => null,
      createDocument: async () => null,
      deleteContainer: async () => null,
      getBlob: async () => null,
      getContainerWriterProjection: async () => null,
      getDocumentWriterProjection: async () => null,
      getEncapsulationKey: async () => null,
      listContainers: async () => listContainersResponse(),
      listDocumentAttachments: async () => null,
      moveContainer: async () => null,
      shareContainer: async () => null,
      stageBlob: async () => null,
      syncDocument: async () => null,
    }),
  };
  const runtime = createExplorerWorkflowRuntime(input);

  return {
    ...runtime,
    close: runtimeBase.close,
    execSql: runtimeBase.execSql,
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
          createdAt: expect.any(String),
          id: "root-container",
          kind: "container",
          name: "/",
          organizationId: "org-1",
          parentId: null,
          updatedAt: expect.any(String),
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
    expect(childNode.createdAt).toEqual(expect.any(String));
    expect(childNode.updatedAt).toEqual(expect.any(String));
    expect(firstStore.getSnapshot().nodes).toHaveLength(2);
    expect(
      firstStore
        .getSnapshot()
        .nodes.some(
          (node) =>
            node.id === childNode.id &&
            node.parentId === "root-container" &&
            node.createdAt === childNode.createdAt &&
            node.updatedAt === childNode.updatedAt,
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

test("explorer store deletes remote leaf containers through the API", async () => {
  const runtime = await createSqlRuntime();
  const deletedContainerIds: string[] = [];

  try {
    runtime.isAuthenticated = true;
    runtime.online = true;
    runtime.apiClient = createMockApiClient({
      deleteContainer: async (containerId: string) => {
        deletedContainerIds.push(containerId);
        return {
          containerId,
          deletedAt: "2026-05-06T18:00:00.000Z",
        };
      },
      listContainers: async () => listContainersResponse(),
    });

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
      id: "remote-child",
      organizationId: "org-1",
      parentId: "root-container",
      metadataDocumentId: "remote-child-metadata-document",
      name: "Remote",
      icon: null,
    });

    const store = createExplorerStore(runtime);
    store.updateRuntime(runtime);

    await waitForCondition(
      () => store.getSnapshot().ready,
      "Explorer store did not become ready.",
    );

    const deleted = await store.deleteContainer("remote-child");
    expect(deleted).toBe(true);
    expect(deletedContainerIds).toEqual(["remote-child"]);
    expect(
      store.getSnapshot().nodes.some((node) => node.id === "remote-child"),
    ).toBe(false);

    const remainingContainers = await loadContainers(runtime.execSql);
    expect(remainingContainers.map((container) => container.id)).toEqual([
      "root-container",
    ]);
  } finally {
    runtime.close();
  }
});

test("explorer store keeps remote containers local when API delete fails", async () => {
  const runtime = await createSqlRuntime();

  try {
    runtime.isAuthenticated = true;
    runtime.online = true;
    runtime.apiClient = createMockApiClient({
      deleteContainer: async () => null,
      listContainers: async () => listContainersResponse(),
    });

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
      id: "remote-child",
      organizationId: "org-1",
      parentId: "root-container",
      metadataDocumentId: "remote-child-metadata-document",
      name: "Remote",
      icon: null,
    });

    const store = createExplorerStore(runtime);
    store.updateRuntime(runtime);

    await waitForCondition(
      () => store.getSnapshot().ready,
      "Explorer store did not become ready.",
    );

    const deleted = await store.deleteContainer("remote-child");
    expect(deleted).toBe(false);
    expect(
      store.getSnapshot().nodes.some((node) => node.id === "remote-child"),
    ).toBe(true);
  } finally {
    runtime.close();
  }
});

test("explorer store removes local remote containers when API delete returns 404", async () => {
  const runtime = await createSqlRuntime();
  const deletedContainerIds: string[] = [];

  try {
    runtime.isAuthenticated = true;
    runtime.online = true;
    runtime.apiClient = createMockApiClient({
      deleteContainerResult: async (containerId: string) => {
        deletedContainerIds.push(containerId);
        return {
          kind: "http",
          message: `DELETE /containers/${containerId}: 404 Not Found`,
          method: "DELETE",
          ok: false,
          path: `/containers/${containerId}`,
          report: () => {},
          status: 404,
          statusText: "Not Found",
        };
      },
      listContainers: async () => listContainersResponse(),
    });

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
      id: "remote-child",
      organizationId: "org-1",
      parentId: "root-container",
      metadataDocumentId: "remote-child-metadata-document",
      name: "Remote",
      icon: null,
    });

    const store = createExplorerStore(runtime);
    store.updateRuntime(runtime);

    await waitForCondition(
      () => store.getSnapshot().ready,
      "Explorer store did not become ready.",
    );

    const deleted = await store.deleteContainer("remote-child");
    expect(deleted).toBe(true);
    expect(deletedContainerIds).toEqual(["remote-child"]);
    expect(
      store.getSnapshot().nodes.some((node) => node.id === "remote-child"),
    ).toBe(false);

    const remainingContainers = await loadContainers(runtime.execSql);
    expect(remainingContainers.map((container) => container.id)).toEqual([
      "root-container",
    ]);
  } finally {
    runtime.close();
  }
});

test("explorer snapshot update skips notifications when node contents are unchanged", async () => {
  const runtime = await createSqlRuntime();

  try {
    const state = createExplorerStoreState(runtime, sqlExplorerPersistence);
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
        loroSnapshot: "",
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
      resolveProjectionUserKey: runtime.createProjectionUserKeyResolver(),
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
    expect(cachedPrincipalBatches).toEqual([2]);
  } finally {
    runtime.close();
  }
});

test("explorer sync agent retries remote ingests after a failed batch", async () => {
  const runtime = await createSqlRuntime();
  let snapshotUpdateCount = 0;
  const cachedPrincipalBatches: number[] = [];

  runtime.cacheReferencedPrincipalPolicies = async (principals) => {
    cachedPrincipalBatches.push(principals?.length ?? 0);
    if (cachedPrincipalBatches.length === 1) {
      throw new Error("principal cache unavailable");
    }
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
      resolveProjectionUserKey: runtime.createProjectionUserKeyResolver(),
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
    expect(cachedPrincipalBatches).toEqual([1, 2]);
  } finally {
    runtime.close();
  }
});

test("explorer sync skips pending metadata updates for containers without document ids", async () => {
  const runtime = await createSqlRuntime();
  const localKeyPair = generateKemSeedAndKeyPair();
  let listPendingCreateIntentCalls = 0;
  let listPendingUpdateCalls = 0;

  runtime.isAuthenticated = true;
  runtime.online = true;
  runtime.encapsulationKeyPair = localKeyPair;

  try {
    const persistence = {
      ...sqlExplorerPersistence,
      listPendingCreateIntents: async () => {
        listPendingCreateIntentCalls += 1;
        return [];
      },
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
    const state: ExplorerSyncState = {
      containersById: new Map([
        [
          "local-container",
          {
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
              loroSnapshot: "",
              contentKeyBundle: null,
              documentKekTargets: null,
              documentManifestBundle: null,
            },
          },
        ],
      ]),
      initializePromise: null,
      initialized: true,
      lastEventCount: 0,
      persistence,
      remoteHydrationPromise: null,
      resolveProjectionUserKey: runtime.createProjectionUserKeyResolver(),
      runtime,
      snapshot: {
        ready: true,
      },
      syncLane: null,
    };
    const syncAgent = createExplorerSyncAgent({
      host: {
        persistContainerState: async (containerState) => containerState.record,
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

test("explorer store creates authenticated child containers through the API before persisting locally", async () => {
  const runtime = await createSqlRuntime();
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

  runtime.isAuthenticated = true;
  runtime.encapsulationKeyPair = localKeyPair;
  runtime.organizationId = "org-1";
  runtime.signingFingerprint = signingFingerprint;
  runtime.signingKeyPair = signingKeyPair;
  runtime.userId = "user-1";
  runtime.apiClient = createMockApiClient({
    ...runtime.apiClient,
    ...harness.apiClient,
    listContainers: async () => listContainersResponse(),
  });
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

    const persistedContainers = await loadContainers(runtime.execSql);
    const persistedChild = persistedContainers.find(
      (container) => container.id === childNode.id,
    );

    expect(persistedChild).not.toBeUndefined();
    expect(persistedChild?.metadataDocumentId).toBe(childNode.id);
    expect(persistedChild?.name).toBe("Docs");
    expect(persistedChild?.createdAt).toBe(childNode.createdAt);
    expect(persistedChild?.updatedAt).toBe(childNode.updatedAt);
    expect(childNode.organizationId).toBe("org-1");
    expect(childNode.parentId).toBe("root-container");
    const pendingRows = await runtime.execSql(
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
    expect(Number(readSqlRowValue(pendingRows[0] ?? {}, "count"))).toBe(1);
  } finally {
    runtime.close();
  }
});

test("explorer store queues authenticated child create when parent has no remote access state", async () => {
  const runtime = await createSqlRuntime();
  const localKeyPair = generateKemSeedAndKeyPair();
  let store: ReturnType<typeof createExplorerStore> | null = null;

  runtime.isAuthenticated = true;
  runtime.online = true;
  runtime.encapsulationKeyPair = localKeyPair;
  runtime.apiClient = createMockApiClient({
    ...runtime.apiClient,
    listContainers: async () => listContainersResponse(),
  });

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
    const authenticatedRuntime: TestRuntime = {
      ...runtime,
      encapsulationKeyPair: localKeyPair,
      isAuthenticated: true,
      online: true,
      organizationId: "org-1",
      signingFingerprint,
      signingKeyPair,
      userId: "user-1",
      apiClient: createMockApiClient({
        ...runtime.apiClient,
        ...harness.apiClient,
        listContainers: async () =>
          listContainersResponse(Array.from(remoteContainers.values())),
      }),
    };

    createdStore.updateRuntime(authenticatedRuntime);

    await waitForCondition(
      () =>
        harness.containerCreateCalls.length === 3 &&
        harness.documentCreateCalls.length === 3,
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
      await sqlExplorerPersistence.listPendingCreateIntents(runtime.execSql),
    ).toEqual([]);

    const persistedContainers = await loadContainers(runtime.execSql);
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
      runtime.dbStatus = "terminated";
      store.updateRuntime(runtime);
    }
    runtime.close();
  }
});

test("explorer store creates a child under a writable shared root through the parent KEK", async () => {
  const runtime = await createSqlRuntime();
  const cachedPrincipalReferences: Array<
    ReadonlyArray<ReferencedPrincipalStateResponse>
  > = [];
  const localKeyPair = generateKemSeedAndKeyPair();
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const signingFingerprint = await toFingerprint(
    signingKeyPair.signingPublicKey,
  );
  const harness = createExplorerContainerApiHarness([
    await createExplorerMetadataContainerProjection({
      containerId: "shared-root-container",
      encapsulationPublicKey: localKeyPair.publicKey,
      organizationId: "org-2",
      signerKeyFingerprint: signingFingerprint,
      signerPrivateKey: signingKeyPair.signingPrivateKey,
      userId: "user-1",
    }),
  ]);

  runtime.isAuthenticated = true;
  runtime.online = true;
  runtime.encapsulationKeyPair = localKeyPair;
  runtime.organizationId = "org-2";
  runtime.signingFingerprint = signingFingerprint;
  runtime.signingKeyPair = signingKeyPair;
  runtime.userId = "user-1";
  runtime.cacheReferencedPrincipalPolicies = async (references) => {
    cachedPrincipalReferences.push(references ?? []);
  };
  runtime.apiClient = createMockApiClient({
    ...runtime.apiClient,
    ...harness.apiClient,
    listContainers: async () =>
      listContainersResponse([
        listedContainer({
          id: "shared-root-container",
          metadataAccessEpoch: 1,
          metadataAccessStateHash: "shared-root-access-state-hash-1",
          metadataDocumentId: "shared-root-metadata-document",
          metadataReferencedPrincipals: [
            {
              keyEpoch: 1,
              keyFingerprint: "key-fingerprint-1",
              principalId: "group-1",
              principalType: "group",
              stateHash: "state-hash-1",
              version: 1,
            },
          ],
          organizationId: "org-2",
          parentId: null,
        }),
      ]),
  });

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

    expect(harness.containerCreateCalls).toEqual([
      {
        containerId: childNode.id,
        metadataDocumentId: childNode.id,
        parentId: "shared-root-container",
        wrapRecipientKinds: ["container"],
      },
    ]);
    expect(harness.documentCreateCalls).toEqual([
      {
        containerId: childNode.id,
        documentId: childNode.id,
      },
    ]);
    expect(cachedPrincipalReferences).toContainEqual([
      {
        keyEpoch: 1,
        keyFingerprint: "key-fingerprint-1",
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

  runtime.isAuthenticated = true;
  runtime.online = true;
  runtime.encapsulationKeyPair = localKeyPair;
  runtime.organizationId = "org-1";
  runtime.signingFingerprint = signingFingerprint;
  runtime.signingKeyPair = signingKeyPair;
  runtime.userId = "user-1";
  runtime.apiClient = createMockApiClient({
    ...runtime.apiClient,
    ...harness.apiClient,
    listContainers: async () => listContainersResponse(remoteContainers),
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
  });

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

    expect(harness.containerMoveCalls).toEqual([
      {
        containerId: "child-container",
        parentId: "parent-b",
        wrapRecipientKinds: ["container"],
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

test("explorer store shares an authenticated container without reseeding metadata envelopes", async () => {
  const runtime = await createSqlRuntime();
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

  runtime.isAuthenticated = true;
  runtime.online = true;
  runtime.encapsulationKeyPair = localKeyPair;
  runtime.organizationId = "org-1";
  runtime.signingFingerprint = signingFingerprint;
  runtime.signingKeyPair = signingKeyPair;
  runtime.userId = "user-1";
  runtime.apiClient = createMockApiClient({
    ...runtime.apiClient,
    ...harness.apiClient,
    getEncapsulationKey: async (requestedUserId: string) => {
      if (requestedUserId !== "550e8400-e29b-41d4-a716-446655440000") {
        return null;
      }

      return {
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
    listContainers: async () => listContainersResponse(),
    syncDocument: async () => {
      syncCallCount += 1;
      return null;
    },
  });
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
        id: "child-container",
        loroSnapshot: bytesToBase64(initialUpdate),
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
      const rows = await runtime.execSql(
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
  const fixture = await createExplorerMetadataFixture({
    containerId: "child-container",
    documentId: "metadata-document-1",
    encapsulationKeyPair: localKeyPair,
    execSql: runtime.execSql,
    syncCalls,
  });

  runtime.isAuthenticated = true;
  runtime.online = true;
  runtime.encapsulationKeyPair = localKeyPair;
  runtime.organizationId = fixture.organizationId;
  runtime.signingFingerprint = fixture.signingFingerprint;
  runtime.signingKeyPair = fixture.signingKeyPair;
  runtime.userId = fixture.userId;
  runtime.apiClient = createMockApiClient({
    ...runtime.apiClient,
    ...fixture.apiClient,
    listContainers: async () => listContainersResponse(),
  });

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
        ...fixture.persistedState,
        accessEpoch: 1,
        accessStateHash: "metadata-access-state-hash-1",
        documentId: "metadata-document-1",
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

    await createdStore.renameContainer("child-container", "Docs updated");

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
  const listContainersOptions: Array<{ parentId?: string | null }> = [];

  runtime.isAuthenticated = true;
  runtime.online = true;
  runtime.encapsulationKeyPair = localKeyPair;
  runtime.apiClient = createMockApiClient({
    ...runtime.apiClient,
    listContainers: async (options = {}) => {
      listContainersCalls += 1;
      listContainersOptions.push(options);

      if (listContainersCalls === 1) {
        return listContainersResponse();
      }

      if (options.parentId === null || options.parentId === undefined) {
        return {
          hasMore: false,
          items: [
            {
              createdAt: "2026-05-05T00:00:00.000Z",
              depth: 0,
              id: "shared-root-container",
              metadataAccessEpoch: 1,
              metadataAccessStateHash: "shared-root-access-state-hash-1",
              metadataDocumentId: "shared-root-metadata-document",
              organizationId: "org-2",
              parentId: null,
              updatedAt: "2026-05-05T00:00:00.000Z",
            },
          ],
          nextWatermark: {
            id: "shared-root-container",
            updatedAt: "2026-05-05T00:00:00.000Z",
          },
          tombstones: [],
        };
      }

      return {
        hasMore: false,
        items: [],
        nextWatermark: null,
        tombstones: [],
      };
    },
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
      sqlContainerSyncWatermarkPersistence.loadWatermark(
        runtime.execSql,
        containerParentSyncLane(null),
      ),
    ).resolves.toEqual({
      id: "shared-root-container",
      updatedAt: "2026-05-05T00:00:00.000Z",
    });
  } finally {
    if (store) {
      runtime.dbStatus = "terminated";
      store.updateRuntime(runtime);
    }
    runtime.close();
  }
});

test("explorer sync hydrates container parent lanes concurrently", async () => {
  const runtime = await createSqlRuntime();
  const localKeyPair = generateKemSeedAndKeyPair();
  let activeListContainerCalls = 0;
  let maxActiveListContainerCalls = 0;
  const requestedParentIds: Array<string | null | undefined> = [];

  runtime.isAuthenticated = true;
  runtime.online = true;
  runtime.encapsulationKeyPair = localKeyPair;
  runtime.apiClient = createMockApiClient({
    ...runtime.apiClient,
    listContainers: async (options = {}) => {
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
    },
  });
  let store: ReturnType<typeof createExplorerStore> | null = null;

  try {
    const createdStore = createExplorerStore(runtime);
    store = createdStore;
    createdStore.updateRuntime(runtime);

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
      runtime.dbStatus = "terminated";
      store.updateRuntime(runtime);
    }
    runtime.close();
  }
});

test("explorer sync retries failed parent lane batches without advancing their watermarks", async () => {
  const runtime = await createSqlRuntime();
  const localKeyPair = generateKemSeedAndKeyPair();
  let parentAFetchCount = 0;
  let parentBFetchCount = 0;

  runtime.isAuthenticated = true;
  runtime.online = true;
  runtime.encapsulationKeyPair = localKeyPair;
  runtime.apiClient = createMockApiClient({
    ...runtime.apiClient,
    listContainers: async (options = {}) => {
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
    },
  });
  let store: ReturnType<typeof createExplorerStore> | null = null;

  try {
    const createdStore = createExplorerStore(runtime);
    store = createdStore;
    createdStore.updateRuntime(runtime);

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
      sqlContainerSyncWatermarkPersistence.loadWatermark(
        runtime.execSql,
        containerParentSyncLane("parent-a"),
      ),
    ).resolves.toBeNull();
    await expect(
      sqlContainerSyncWatermarkPersistence.loadWatermark(
        runtime.execSql,
        containerParentSyncLane("parent-b"),
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
      sqlContainerSyncWatermarkPersistence.loadWatermark(
        runtime.execSql,
        containerParentSyncLane("parent-a"),
      ),
    ).resolves.toEqual({
      id: "child-a",
      updatedAt: TEST_SYNC_TIMESTAMP,
    });
    await expect(
      sqlContainerSyncWatermarkPersistence.loadWatermark(
        runtime.execSql,
        containerParentSyncLane("parent-b"),
      ),
    ).resolves.toEqual({
      id: "child-b",
      updatedAt: TEST_SYNC_TIMESTAMP,
    });
  } finally {
    if (store) {
      runtime.dbStatus = "terminated";
      store.updateRuntime(runtime);
    }
    runtime.close();
  }
});

test("explorer sync applies container tombstones before advancing the parent watermark", async () => {
  const runtime = await createSqlRuntime();
  const localKeyPair = generateKemSeedAndKeyPair();

  runtime.isAuthenticated = true;
  runtime.online = true;
  runtime.encapsulationKeyPair = localKeyPair;
  runtime.apiClient = createMockApiClient({
    ...runtime.apiClient,
    listContainers: async (options = {}) => {
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
    },
  });
  let store: ReturnType<typeof createExplorerStore> | null = null;

  try {
    await sqlExplorerPersistence.ensureSchema(runtime.execSql);
    await sqlDocumentsPersistence.ensureSchema(runtime.execSql);
    await sqlDocumentContainerProjectionPersistence.ensureSchema(
      runtime.execSql,
    );

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
      metadataDocumentId: null,
      name: "Child",
      icon: null,
    });
    await saveContainer(runtime.execSql, {
      id: "archive-container",
      organizationId: "org-1",
      parentId: "root-container",
      metadataDocumentId: null,
      name: "Archive",
      icon: null,
    });
    await saveContainer(runtime.execSql, {
      id: "grandchild-container",
      organizationId: "org-1",
      parentId: "child-container",
      metadataDocumentId: null,
      name: "Grandchild",
      icon: null,
    });
    await sqlDocumentsPersistence.saveDocument(
      runtime.execSql,
      {
        accessEpoch: 1,
        accessStateHash: "document-access-state-hash-1",
        containerId: "child-container",
        documentId: "remote-document",
        id: "local-document",
        lastCommitLsn: null,
        loroSnapshot: "",
        text: "Shared document",
      },
      { updatedAt: "2026-05-05T00:00:00.000Z" },
    );
    await sqlDocumentContainerProjectionPersistence.replaceDocumentLinks(
      runtime.execSql,
      "remote-document",
      ["archive-container", "child-container"],
    );
    await sqlContainerSyncWatermarkPersistence.saveWatermark(
      runtime.execSql,
      containerParentSyncLane("child-container"),
      {
        id: "previous-child-lane",
        updatedAt: "2026-05-04T00:00:00.000Z",
      },
    );
    await sqlContainerSyncWatermarkPersistence.saveWatermark(
      runtime.execSql,
      containerDocumentsSyncLane("child-container"),
      {
        id: "previous-document-lane",
        updatedAt: "2026-05-04T00:00:00.000Z",
      },
    );
    await sqlContainerSyncWatermarkPersistence.saveWatermark(
      runtime.execSql,
      containerParentSyncLane("grandchild-container"),
      {
        id: "previous-grandchild-lane",
        updatedAt: "2026-05-04T00:00:00.000Z",
      },
    );

    const createdStore = createExplorerStore(runtime);
    store = createdStore;
    createdStore.updateRuntime(runtime);

    await waitForCondition(
      () =>
        createdStore.getSnapshot().ready &&
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
      sqlContainerSyncWatermarkPersistence.loadWatermark(
        runtime.execSql,
        containerParentSyncLane("root-container"),
      ),
    ).resolves.toEqual({
      id: "child-container",
      updatedAt: "2026-05-05T00:00:02.000Z",
    });
    await expect(
      sqlContainerSyncWatermarkPersistence.loadWatermark(
        runtime.execSql,
        containerParentSyncLane("child-container"),
      ),
    ).resolves.toBeNull();
    await expect(
      sqlContainerSyncWatermarkPersistence.loadWatermark(
        runtime.execSql,
        containerDocumentsSyncLane("child-container"),
      ),
    ).resolves.toBeNull();
    await expect(
      sqlContainerSyncWatermarkPersistence.loadWatermark(
        runtime.execSql,
        containerParentSyncLane("grandchild-container"),
      ),
    ).resolves.toBeNull();
    await expect(
      sqlDocumentContainerProjectionPersistence.listLinkedContainerIds(
        runtime.execSql,
        "remote-document",
      ),
    ).resolves.toEqual(["archive-container"]);

    const repairedDocument = await sqlDocumentsPersistence.loadDocument(
      runtime.execSql,
      "local-document",
    );
    expect(repairedDocument?.containerId).toBe("archive-container");
  } finally {
    if (store) {
      runtime.dbStatus = "terminated";
      store.updateRuntime(runtime);
    }
    runtime.close();
  }
});

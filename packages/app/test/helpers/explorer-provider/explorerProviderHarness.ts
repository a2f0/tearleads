import {
  buildMaterializedDocumentCreatePlan,
  createDocumentSignerDeviceId,
  createContainerContentsWorkflowRuntime as createExplorerWorkflowRuntime,
  persistedDocumentCreateStateFromResponse,
} from "@symcrypt/client-sdk";
import { generateSigningSeedAndKeyPair, toFingerprint } from "@symcrypt/crypto";
import { bytesToBase64 } from "@symcrypt/encoding";
import {
  createContainerParentLaneBatchMock,
  createMockApiClient,
} from "@symcrypt/test-utils";
import type {
  ContainerCreateWithMetadataDocumentRequest,
  ContainerMutationRequest,
  DocumentCreateRequest,
  DocumentSyncRequest,
} from "@symcrypt/validators/request";
import type {
  ContainerWriterProjectionResponse,
  DocumentCreateResponse,
  DocumentWriterProjectionResponse,
} from "@symcrypt/validators/response";
import { createSqlRuntimeBase } from "../createSqlRuntime";
import { createTestRuntimeTrustedUserIdentityResolver } from "../trustedUserIdentity";
import {
  createExplorerContainerMutationResponse,
  createExplorerMetadataContainerProjection,
  createExplorerMetadataCreateResponse,
  createExplorerMetadataSyncResponse,
  listContainersResponse,
  readRequestString,
  type TestRuntime,
} from "./explorerProviderFixtures";

export { runtimeWithPatch } from "./explorerRuntimePatch";

function sortWrapRecipientKinds(wraps: ReadonlyArray<object>): string[] {
  return wraps
    .map((wrap) => Reflect.get(wrap, "recipientKind"))
    .filter((kind): kind is string => typeof kind === "string")
    .sort();
}

export function createExplorerContainerApiHarness(
  initialProjections: readonly ContainerWriterProjectionResponse[],
) {
  const projections = new Map(
    initialProjections.map((projection) => [
      projection.containerId,
      projection,
    ]),
  );
  const createdDocuments = new Map<string, DocumentCreateResponse>();
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
  const containerMetadataCreateCalls: Array<{
    containerId: string;
    metadataDocumentId: string;
  }> = [];
  const documentSyncCalls: Array<{
    documentId: string;
    outgoingUpdateCount: number;
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
          wrapRecipientKinds: sortWrapRecipientKinds(request.wraps),
        });
        return response;
      },
      createContainerWithMetadataDocument: async (
        request: ContainerCreateWithMetadataDocumentRequest,
      ) => {
        const container = await createExplorerContainerMutationResponse(
          request.container,
        );
        const parentProjection = projections.get(container.parentId ?? "");
        if (!parentProjection) {
          return null;
        }

        projections.set(container.containerId, {
          containerId: container.containerId,
          organizationId: container.organizationId,
          path: [...parentProjection.path, container.accessManifest],
          containerKeks: [
            ...parentProjection.containerKeks,
            container.containerKek,
          ],
        });

        const metadataDocument = await createExplorerMetadataCreateResponse(
          request.metadataDocument,
        );
        createdDocuments.set(metadataDocument.id, metadataDocument);
        containerCreateCalls.push({
          containerId: container.containerId,
          metadataDocumentId: readRequestString(
            request.container.body as Record<string, unknown>,
            "metadataDocumentId",
          ),
          parentId: container.parentId ?? "",
          wrapRecipientKinds: sortWrapRecipientKinds(request.container.wraps),
        });
        documentCreateCalls.push({
          containerId: readRequestString(
            request.metadataDocument.body as Record<string, unknown>,
            "containerId",
          ),
          documentId: metadataDocument.id,
        });
        containerMetadataCreateCalls.push({
          containerId: container.containerId,
          metadataDocumentId: metadataDocument.id,
        });

        return { container, metadataDocument };
      },
      createDocument: async (request: DocumentCreateRequest) => {
        const response = await createExplorerMetadataCreateResponse(request);
        createdDocuments.set(response.id, response);
        documentCreateCalls.push({
          containerId: readRequestString(
            request.body as Record<string, unknown>,
            "containerId",
          ),
          documentId: response.id,
        });
        return response;
      },
      getDocumentWriterProjection: async (
        documentId: string,
      ): Promise<DocumentWriterProjectionResponse | null> => {
        const storedDocument = createdDocuments.get(documentId);
        if (!storedDocument) {
          return null;
        }
        const linkedContainerIds = Reflect.get(
          storedDocument.accessManifest.state,
          "linkedContainerIds",
        );
        const linkedContainerId =
          Array.isArray(linkedContainerIds) &&
          typeof linkedContainerIds[0] === "string"
            ? linkedContainerIds[0]
            : "";
        const containerProjection = projections.get(linkedContainerId);
        if (!containerProjection) {
          return null;
        }

        return {
          authorizingContainerPaths: [containerProjection],
          contentKeyBundle: storedDocument.contentKeyBundle,
          documentId: storedDocument.id,
          documentKekTargets: storedDocument.documentKekTargets,
          documentManifest: storedDocument.accessManifest,
          documentManifestHistory: [],
          documentManifestContainerPaths: [],
          documentContainerManifestHistory: [],
        };
      },
      getContainerWriterProjection: async (containerId: string) =>
        projections.get(containerId) ?? null,
      syncDocument: async (
        documentId: string,
        request: DocumentSyncRequest,
      ) => {
        const storedDocument = createdDocuments.get(documentId);
        if (!storedDocument) {
          return null;
        }
        documentSyncCalls.push({
          documentId,
          outgoingUpdateCount: request.outgoingUpdates.length,
        });

        return createExplorerMetadataSyncResponse({
          commitLsn: `0/${documentSyncCalls.length * 10}`,
          request,
          storedDocument,
        });
      },
      shareContainer: async (
        containerId: string,
        request: ContainerMutationRequest,
      ) => {
        const previousProjection = projections.get(containerId);
        if (!previousProjection) {
          return null;
        }
        const response = await createExplorerContainerMutationResponse(
          request,
          previousProjection,
        );

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
          wrapRecipientKinds: sortWrapRecipientKinds(request.wraps),
        });
        return response;
      },
      moveContainer: async (
        containerId: string,
        request: ContainerMutationRequest,
      ) => {
        const previousProjection = projections.get(containerId);
        if (!previousProjection) {
          return null;
        }
        const response = await createExplorerContainerMutationResponse(
          request,
          previousProjection,
        );
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
          wrapRecipientKinds: sortWrapRecipientKinds(request.wraps),
        });
        return response;
      },
    }),
    containerCreateCalls,
    containerMetadataCreateCalls,
    documentCreateCalls,
    documentSyncCalls,
    containerMoveCalls,
    containerShareCalls,
    projections,
  };
}

export async function createExplorerMetadataFixture(input: {
  containerId: string;
  documentId: string;
  encapsulationKeyPair: NonNullable<
    TestRuntime["crypto"]["encapsulationKeyPair"]
  >;
  execSql: TestRuntime["infra"]["execSql"];
  organizationId?: string;
  syncCalls?: Array<{ minLsn: string | null; outgoingUpdateCount: number }>;
}): Promise<{
  apiClient: ReturnType<typeof createMockApiClient>;
  organizationId: string;
  persistedState: ReturnType<typeof persistedDocumentCreateStateFromResponse>;
  signingFingerprint: string;
  signingKeyPair: ReturnType<typeof generateSigningSeedAndKeyPair>;
  userId: string;
}> {
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
    documentManifestHistory: [],
    documentManifestContainerPaths: [],
    documentContainerManifestHistory: [],
  };

  return {
    apiClient: createMockApiClient({
      getUserIdentity: async (requestedUserId: string) => {
        if (requestedUserId !== userId) {
          return null;
        }

        return {
          encapsulationKeyFingerprint: await toFingerprint(
            input.encapsulationKeyPair.publicKey,
          ),
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

export async function createSqlRuntime(): Promise<TestRuntime> {
  const runtimeBase = await createSqlRuntimeBase("explorer-provider-test");
  const input = {
    ...runtimeBase,
    apiClient: createMockApiClient({
      bindBlobAttachment: async () => null,
      createContainer: async () => null,
      createDocument: async () => null,
      deleteContainer: async () => null,
      getContainerWriterProjection: async () => null,
      getDocumentWriterProjection: async () => null,
      getUserIdentity: async () => null,
      listContainerParentLanes: createContainerParentLaneBatchMock(async () =>
        listContainersResponse(),
      ),
      listDocumentAttachments: async () => null,
      moveContainer: async () => null,
      shareContainer: async () => null,
      syncDocument: async () => null,
    }),
  };
  const runtime = createExplorerWorkflowRuntime({
    ...input,
    resolveTrustedUserIdentity: createTestRuntimeTrustedUserIdentityResolver({
      encapsulationPublicKey: null,
      loadRemoteIdentity: (userId) => input.apiClient.getUserIdentity(userId),
      localUserId: null,
      signingKeyFingerprint: null,
      signingPublicKey: null,
    }),
  });

  return {
    ...runtime,
    adoptRootContainer: () => false,
    close: runtimeBase.close,
  };
}

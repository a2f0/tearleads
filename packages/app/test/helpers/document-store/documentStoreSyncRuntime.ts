import { createDomainScope, createMemoryBlobStore } from "@symcrypt/client-sdk";
import { generateSigningSeedAndKeyPair, toFingerprint } from "@symcrypt/crypto";
import { bytesToBase64 } from "@symcrypt/encoding";
import {
  createContainerParentLaneBatchMock,
  createMockApiClient,
} from "@symcrypt/test-utils";
import type {
  BlobAttachmentBindRequest,
  DocumentSyncRequest,
} from "@symcrypt/validators/request";
import type {
  BlobAttachmentBindResponse,
  BlobAttachmentSummary,
  ContainerWriterProjectionResponse,
  DocumentCreateResponse,
  DocumentWriterProjectionResponse,
} from "@symcrypt/validators/response";
import { APP_DOCUMENT_PROJECTOR_DEFINITIONS } from "../../../src/document-types/projectors";
import { createSqlRuntimeBase } from "../createSqlRuntime";
import { createTestRuntimeTrustedUserIdentityResolver } from "../trustedUserIdentity";
import { waitForCondition } from "../waitForCondition";
import { createDocumentStoreMultipartApi } from "./documentStoreMultipartApi";
import {
  createDocumentAttachmentBindResponse,
  createDocumentContainerProjection,
  createDocumentCreateResponse,
  createDocumentSyncResponse,
  createDocumentsRuntimeInput,
  createDocumentsTestRuntime,
  createListedContainers,
  createUnavailableDocumentsApiClient,
  type DocumentRuntimePatch,
  type DocumentsRuntimeInput,
  type DocumentsTestRuntime,
} from "./documentStoreSyncFixtures";
import { readRowValue } from "./documentStoreSyncPersistence";

export async function documentWorkflowRuntimePatch(input: {
  attachmentBinds?: Array<{
    blobId: string;
    request: BlobAttachmentBindRequest;
  }>;
  containerId?: string;
  encapsulationKeyPair: NonNullable<
    DocumentsRuntimeInput["crypto"]["encapsulationKeyPair"]
  >;
  onBindBlobAttachment?: (
    blobId: string,
    request: BlobAttachmentBindRequest,
  ) => Promise<void> | void;
  onBlobAttachmentCommitted?: (
    blobId: string,
    request: BlobAttachmentBindRequest,
    response: BlobAttachmentBindResponse,
  ) => Promise<void> | void;
  mapBindBlobAttachmentResponse?: (
    response: BlobAttachmentBindResponse,
  ) => BlobAttachmentBindResponse;
  mapDocumentWriterProjectionResponse?: (
    response: DocumentWriterProjectionResponse,
  ) => DocumentWriterProjectionResponse;
  commitLsnForSyncCount?: (syncCount: number) => string;
  documentWriterProjectionCalls?: string[];
  listDocumentAttachmentsCalls?: string[];
  organizationId?: string;
  onSyncDocumentRequest?: (request: DocumentSyncRequest) => void;
  syncCalls?: Array<{ minLsn: string | null; outgoingUpdateCount: number }>;
}): Promise<DocumentRuntimePatch> {
  const containerId = input.containerId ?? "root-container";
  const organizationId = input.organizationId ?? "organization-1";
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const signingFingerprint = await toFingerprint(
    signingKeyPair.signingPublicKey,
  );
  let projectionPromise: Promise<ContainerWriterProjectionResponse> | null =
    null;
  let storedDocument: DocumentCreateResponse | null = null;
  let syncCount = 0;
  const attachments: BlobAttachmentSummary[] = [];
  const multipart = createDocumentStoreMultipartApi();
  const blobs = new Map<
    string,
    {
      encryptedBytes: Uint8Array<ArrayBuffer>;
      sha256: string;
    }
  >();
  const getProjection = () => {
    projectionPromise ??= createDocumentContainerProjection({
      containerId,
      encapsulationPublicKey: input.encapsulationKeyPair.publicKey,
      organizationId,
      signerKeyFingerprint: signingFingerprint,
      signerPrivateKey: signingKeyPair.signingPrivateKey,
      userId: "user-1",
    });
    return projectionPromise;
  };

  return {
    apiClient: createMockApiClient({
      createDocument: async (request) => {
        storedDocument = await createDocumentCreateResponse(request);
        return storedDocument;
      },
      ...multipart.api,
      bindBlobAttachment: async (blobId, request) => {
        const stagedBlob = request.stagedBlob
          ? multipart.getCompleted(request.stagedBlob.stageId)
          : null;
        if (request.stagedBlob && !stagedBlob) {
          return null;
        }
        if (!storedDocument) {
          return null;
        }
        const boundDocument = storedDocument;
        await input.onBindBlobAttachment?.(blobId, request);
        const responseFixture = await createDocumentAttachmentBindResponse({
          blobId,
          documentManifest: boundDocument.accessManifest,
          request,
        });
        const response =
          input.mapBindBlobAttachmentResponse?.(responseFixture) ??
          responseFixture;
        input.attachmentBinds?.push({ blobId, request });
        attachments.push(response);
        if (stagedBlob) {
          blobs.set(blobId, {
            encryptedBytes: stagedBlob.bytes,
            sha256: stagedBlob.sha256,
          });
        }
        await input.onBlobAttachmentCommitted?.(blobId, request, response);
        return response;
      },
      getBlobBytes: async (blobId) => {
        const blob = blobs.get(blobId);
        if (!blob) {
          return null;
        }

        const encryptedBytes = blob.encryptedBytes.slice();
        return {
          blobId,
          byteLength: encryptedBytes.byteLength,
          encryptedBytes: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(encryptedBytes);
              controller.close();
            },
          }),
          sha256: blob.sha256,
        };
      },
      getUserIdentity: async (userId) =>
        userId === "user-1"
          ? {
              encapsulationKeyFingerprint: await toFingerprint(
                input.encapsulationKeyPair.publicKey,
              ),
              encapsulationPublicKey: bytesToBase64(
                input.encapsulationKeyPair.publicKey,
              ),
              signingKeyFingerprint: signingFingerprint,
              signingPublicKey: bytesToBase64(signingKeyPair.signingPublicKey),
              userId,
            }
          : null,
      getContainerWriterProjection: () => getProjection(),
      getDocumentWriterProjection: async (documentId) => {
        input.documentWriterProjectionCalls?.push(documentId);
        // Serve only the document this mock actually stores; a real server
        // never answers a projection request with a different document.
        if (!storedDocument || storedDocument.id !== documentId) {
          return null;
        }
        const projection = {
          authorizingContainerPaths: [await getProjection()],
          contentKeyBundle: storedDocument.contentKeyBundle,
          documentId: storedDocument.id,
          documentKekTargets: storedDocument.documentKekTargets,
          documentManifest: storedDocument.accessManifest,
          documentManifestHistory: [],
          documentManifestContainerPaths: [],
          documentContainerManifestHistory: [],
        };
        return (
          input.mapDocumentWriterProjectionResponse?.(projection) ?? projection
        );
      },
      listContainerParentLanes: createContainerParentLaneBatchMock(async () =>
        createListedContainers(
          containerId,
          `${containerId}-access-state-hash-1`,
          organizationId,
        ),
      ),
      listDocumentAttachments: async (documentId) => {
        input.listDocumentAttachmentsCalls?.push(documentId);
        return attachments;
      },
      syncDocument: async (_documentId, request) => {
        if (!storedDocument) {
          return null;
        }
        input.onSyncDocumentRequest?.(request);
        input.syncCalls?.push({
          minLsn: request.minLsn ?? null,
          outgoingUpdateCount: request.outgoingUpdates.length,
        });
        syncCount += 1;
        return createDocumentSyncResponse({
          request,
          storedDocument,
          commitLsn:
            input.commitLsnForSyncCount?.(syncCount) ??
            (syncCount === 1 ? "0/10" : "0/20"),
        });
      },
    }),
    organizationId,
    signingFingerprint,
    signingKeyPair,
    userId: "user-1",
  };
}

export function createRuntime(
  containerId = "root-container",
): DocumentsTestRuntime {
  return createDocumentsTestRuntime(
    createDocumentsRuntimeInput({
      apiClient: createUnavailableDocumentsApiClient(containerId),
      state: {
        containerId,
      },
    }),
  );
}

interface SyncRuntimeOptions {
  attachmentBinds?: Array<{
    blobId: string;
    request: BlobAttachmentBindRequest;
  }>;
  commitLsnForSyncCount?: (syncCount: number) => string;
  documentWriterProjectionCalls?: string[];
  onBindBlobAttachment?: (
    blobId: string,
    request: BlobAttachmentBindRequest,
  ) => Promise<void> | void;
  onBlobAttachmentCommitted?: (
    blobId: string,
    request: BlobAttachmentBindRequest,
    response: BlobAttachmentBindResponse,
  ) => Promise<void> | void;
  onSyncDocumentRequest?: (request: DocumentSyncRequest) => void;
  listDocumentAttachmentsCalls?: string[];
  organizationId?: string;
  syncCalls?: Array<{ minLsn: string | null; outgoingUpdateCount: number }>;
}

async function createSyncRuntimeInput(
  encapsulationKeyPair: NonNullable<
    DocumentsRuntimeInput["crypto"]["encapsulationKeyPair"]
  >,
  containerId = "root-container",
  options: SyncRuntimeOptions = {},
): Promise<DocumentsRuntimeInput> {
  const patch = await documentWorkflowRuntimePatch({
    containerId,
    encapsulationKeyPair,
    ...(options.organizationId
      ? { organizationId: options.organizationId }
      : {}),
    ...(options.attachmentBinds
      ? { attachmentBinds: options.attachmentBinds }
      : {}),
    ...(options.commitLsnForSyncCount
      ? { commitLsnForSyncCount: options.commitLsnForSyncCount }
      : {}),
    ...(options.documentWriterProjectionCalls
      ? { documentWriterProjectionCalls: options.documentWriterProjectionCalls }
      : {}),
    ...(options.onBindBlobAttachment
      ? { onBindBlobAttachment: options.onBindBlobAttachment }
      : {}),
    ...(options.onBlobAttachmentCommitted
      ? { onBlobAttachmentCommitted: options.onBlobAttachmentCommitted }
      : {}),
    ...(options.onSyncDocumentRequest
      ? { onSyncDocumentRequest: options.onSyncDocumentRequest }
      : {}),
    ...(options.listDocumentAttachmentsCalls
      ? { listDocumentAttachmentsCalls: options.listDocumentAttachmentsCalls }
      : {}),
    ...(options.syncCalls ? { syncCalls: options.syncCalls } : {}),
  });
  return {
    apiClient: patch.apiClient,
    auth: {
      isAuthenticated: true,
      organizationId: patch.organizationId,
      userId: patch.userId,
    },
    crypto: {
      encapsulationKeyPair,
      signingFingerprint: patch.signingFingerprint,
      signingKeyPair: patch.signingKeyPair,
    },
    infra: {
      blobStore: createMemoryBlobStore(),
      dbStatus: "ready",
      documentProjectors: APP_DOCUMENT_PROJECTOR_DEFINITIONS,
      execSql: async () => [],
    },
    resolveTrustedUserIdentity: createTestRuntimeTrustedUserIdentityResolver({
      encapsulationPublicKey: encapsulationKeyPair.publicKey,
      loadRemoteIdentity: (userId) => patch.apiClient.getUserIdentity(userId),
      localUserId: patch.userId,
      signingKeyFingerprint: patch.signingFingerprint,
      signingPublicKey: patch.signingKeyPair.signingPublicKey,
    }),
    state: {
      containerId,
      domainScope: createDomainScope(),
      events: [],
      online: true,
    },
    util: {
      log: () => {},
      reportSecurityIncident: async () => undefined,
    },
  };
}

export async function createSyncRuntime(
  encapsulationKeyPair: NonNullable<
    DocumentsRuntimeInput["crypto"]["encapsulationKeyPair"]
  >,
  containerId = "root-container",
  options: SyncRuntimeOptions = {},
): Promise<DocumentsTestRuntime> {
  return createDocumentsTestRuntime(
    await createSyncRuntimeInput(encapsulationKeyPair, containerId, options),
  );
}

export function createOfflineAttachmentRuntime(
  encapsulationKeyPair: NonNullable<
    DocumentsRuntimeInput["crypto"]["encapsulationKeyPair"]
  >,
  containerId = "root-container",
): DocumentsTestRuntime {
  return createDocumentsTestRuntime(
    createDocumentsRuntimeInput({
      apiClient: createUnavailableDocumentsApiClient(containerId),
      crypto: {
        encapsulationKeyPair,
      },
      state: {
        containerId,
      },
    }),
  );
}

export async function waitForStoredDocumentText(
  runtime: DocumentsTestRuntime,
  localId: string,
  text: string,
) {
  await waitForCondition(async () => {
    const rows = await runtime.infra.execSql(
      `
 SELECT text
 FROM document_projection_text
 WHERE local_id = :localId
 `,
      {
        ":localId": localId,
      },
    );
    const rowText = readRowValue(rows[0], "text");
    return rowText === text;
  }, `Document ${localId} did not persist the expected text.`);
}

export async function createSqlRuntime(): Promise<
  DocumentsTestRuntime & {
    close: () => void;
  }
> {
  const runtimeBase = await createSqlRuntimeBase("document-store-sync-test");
  const { close, ...runtimeInputBase } = runtimeBase;

  return {
    ...createDocumentsTestRuntime({
      ...runtimeInputBase,
      apiClient: createUnavailableDocumentsApiClient(),
      state: {
        ...runtimeInputBase.state,
        containerId: "root-container",
      },
    }),
    close,
  };
}

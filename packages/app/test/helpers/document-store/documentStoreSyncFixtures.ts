import {
  createDocumentsWorkflowRuntime,
  createDomainScope,
  createMemoryBlobStore,
  type DocumentRecord,
  type DocumentSummary,
  type DocumentsRuntime,
  type LocalAttachmentRecord,
  type PendingAttachmentRecord,
  type PendingUpdateRecord,
} from "@symcrypt/client-sdk";
import {
  computeAccessEventHash,
  computeBlobAccessManifestHash,
  computeWriteHeaderHash,
} from "@symcrypt/crypto";
import {
  createContainerParentLaneBatchMock,
  createContainerWriterProjectionFixture,
  createMockApiClient,
} from "@symcrypt/test-utils";
import type {
  BlobAttachmentBindRequest,
  DocumentCreateRequest,
  DocumentSyncRequest,
} from "@symcrypt/validators/request";
import type {
  ContainerWriterProjectionResponse,
  DocumentCreateResponse,
  DocumentSyncResponse,
  ListContainersResponse,
} from "@symcrypt/validators/response";
import { APP_DOCUMENT_PROJECTOR_DEFINITIONS } from "../../../src/document-types/projectors";
import {
  assertAccessEvent,
  assertOptionalWriteHeader,
  assertWriteHeader,
} from "../keyingAssertions";
import { createTestRuntimeTrustedUserIdentityResolver } from "../trustedUserIdentity";

export interface StoredDocumentsState {
  document: DocumentRecord | null;
  documentSummaries: DocumentSummary[];
  localAttachments: LocalAttachmentRecord[];
  pendingAttachments: PendingAttachmentRecord[];
  pendingUpdates: PendingUpdateRecord[];
}

export type DocumentsRuntimeInput = Parameters<
  typeof createDocumentsWorkflowRuntime
>[0];
export type DocumentsTestRuntime = DocumentsRuntime;
type DocumentsRuntimeInputOverrides = {
  apiClient?: DocumentsRuntimeInput["apiClient"];
  auth?: Partial<DocumentsRuntimeInput["auth"]>;
  crypto?: Partial<DocumentsRuntimeInput["crypto"]>;
  infra?: Partial<DocumentsRuntimeInput["infra"]>;
  resolveTrustedUserIdentity?: DocumentsRuntimeInput["resolveTrustedUserIdentity"];
  state?: Partial<DocumentsRuntimeInput["state"]>;
  util?: Partial<DocumentsRuntimeInput["util"]>;
};

export interface PendingUpdateLengthRow {
  update_data_length: number | string | null;
}

export interface ProjectionLengthRow {
  text_length: number | string | null;
}

export function createListedContainers(
  containerId: string,
  metadataAccessStateHash = `${containerId}-access-state-hash-1`,
  organizationId = "org-1",
): ListContainersResponse {
  const updatedAt = "2026-05-05T00:00:00.000Z";
  return {
    hasMore: false,
    items: [
      {
        createdAt: updatedAt,
        depth: 0,
        effectiveAccessLevel: "admin",
        id: containerId,
        metadataAccessEpoch: 1,
        metadataAccessStateHash,
        metadataDocumentId: `metadata-${containerId}`,
        metadataReferencedPrincipals: [],
        organizationId,
        parentId: null,
        updatedAt,
      },
    ],
    nextWatermark: { id: containerId, updatedAt },
    tombstones: [],
  };
}

export function createUnavailableDocumentsApiClient(
  containerId = "root-container",
): DocumentsRuntimeInput["apiClient"] {
  return createMockApiClient({
    bindBlobAttachment: async () => null,
    createDocument: async () => null,
    getUserIdentity: async () => null,
    getContainerWriterProjection: async () => null,
    getDocumentWriterProjection: async () => null,
    listContainerParentLanes: createContainerParentLaneBatchMock(async () =>
      createListedContainers(containerId),
    ),
    listDocumentAttachments: async () => null,
    syncDocument: async () => null,
  });
}

export function createDocumentsRuntimeInput(
  overrides: DocumentsRuntimeInputOverrides = {},
): DocumentsRuntimeInput {
  const apiClient =
    overrides.apiClient ??
    createUnavailableDocumentsApiClient("root-container");
  const auth = {
    isAuthenticated: false,
    organizationId: null,
    userId: null,
    ...overrides.auth,
  };
  const crypto = {
    encapsulationKeyPair: null,
    signingFingerprint: null,
    signingKeyPair: null,
    ...overrides.crypto,
  };
  return {
    apiClient,
    auth,
    crypto,
    infra: {
      blobStore: createMemoryBlobStore(),
      dbStatus: "ready",
      documentProjectors: APP_DOCUMENT_PROJECTOR_DEFINITIONS,
      execSql: async () => [],
      ...overrides.infra,
    },
    resolveTrustedUserIdentity:
      overrides.resolveTrustedUserIdentity ??
      createTestRuntimeTrustedUserIdentityResolver({
        encapsulationPublicKey: crypto.encapsulationKeyPair?.publicKey ?? null,
        loadRemoteIdentity: (userId) => apiClient.getUserIdentity(userId),
        localUserId: auth.userId,
        signingKeyFingerprint: crypto.signingFingerprint,
        signingPublicKey: crypto.signingKeyPair?.signingPublicKey ?? null,
      }),
    state: {
      containerId: "root-container",
      domainScope: createDomainScope(),
      events: [],
      online: false,
      ...overrides.state,
    },
    util: {
      log: () => {},
      reportSecurityIncident: async () => undefined,
      ...overrides.util,
    },
  };
}

export function createDocumentsTestRuntime(
  input: DocumentsRuntimeInput,
): DocumentsTestRuntime {
  return createDocumentsWorkflowRuntime(input);
}

export function cloneDocumentsTestRuntime(
  runtime: DocumentsTestRuntime,
  overrides: DocumentsRuntimeInputOverrides,
): DocumentsTestRuntime {
  return createDocumentsTestRuntime(
    createDocumentsRuntimeInput({
      apiClient: overrides.apiClient ?? runtime.apiClient,
      auth: {
        ...runtime.auth,
        ...overrides.auth,
      },
      crypto: {
        ...runtime.crypto,
        ...overrides.crypto,
      },
      infra: {
        ...runtime.infra,
        ...overrides.infra,
      },
      state: {
        ...runtime.state,
        ...overrides.state,
      },
      util: {
        ...runtime.util,
        ...overrides.util,
      },
    }),
  );
}

export async function createDocumentContainerProjection(input: {
  containerId: string;
  encapsulationPublicKey: Uint8Array;
  organizationId?: string;
  signerKeyFingerprint: string;
  signerPrivateKey: Uint8Array;
  userId: string;
}): Promise<ContainerWriterProjectionResponse> {
  return createContainerWriterProjectionFixture({
    containerId: input.containerId,
    encapsulationPublicKey: input.encapsulationPublicKey,
    organizationId: input.organizationId ?? "organization-1",
    signerKeyFingerprint: input.signerKeyFingerprint,
    signerPrivateKey: input.signerPrivateKey,
    userId: input.userId,
  });
}

export async function createDocumentCreateResponse(
  request: DocumentCreateRequest,
): Promise<DocumentCreateResponse> {
  const manifest = request.manifest as Record<string, unknown>;
  const body = request.body as Record<string, unknown>;
  const documentId = String(Reflect.get(manifest, "objectId"));
  const event = assertAccessEvent(request.event, "document create event");
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

export async function createDocumentSyncResponse(input: {
  request: DocumentSyncRequest;
  storedDocument: DocumentCreateResponse;
  commitLsn: string;
}): Promise<DocumentSyncResponse> {
  const updates = await Promise.all(
    input.request.outgoingUpdates.map(async (update) => {
      const writeHeader = assertWriteHeader(
        update.writeHeader,
        "document sync write header",
      );
      return {
        accessEpoch: 1,
        id: update.id,
        documentId: input.storedDocument.id,
        authorFingerprint: writeHeader.writerKeyFingerprint,
        encryptedData: update.encryptedData,
        partialStartVersionVector: update.partialStartVersionVector,
        partialEndVersionVector: update.partialEndVersionVector,
        plaintextHash: update.plaintextHash,
        createdAt: "2026-04-27T00:00:00.000Z",
        writeHeader: update.writeHeader,
      };
    }),
  );

  return {
    acceptedOutgoingUpdateIds: input.request.outgoingUpdates.map(
      (update) => update.id,
    ),
    commitLsn: input.commitLsn,
    contentKeyBundle: input.storedDocument.contentKeyBundle,
    contentKeyBundles: [input.storedDocument.contentKeyBundle],
    documentId: input.storedDocument.id,
    documentKekTargets: input.storedDocument.documentKekTargets,
    pullPage: { hasMore: false, nextCursor: null },
    updates,
  };
}

function uniqueSortedStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

export async function createDocumentAttachmentBindResponse(input: {
  blobId: string;
  // The bind request no longer echoes the document link-set manifest (the server
  // resolves it from its own store), so callers pass the document's current
  // manifest explicitly for the projection this fixture builds.
  documentManifest: DocumentCreateResponse["accessManifest"];
  request: BlobAttachmentBindRequest;
}) {
  const body = input.request.body as Record<string, unknown>;
  const bindingId = String(Reflect.get(body, "bindingId"));
  const documentId = String(Reflect.get(body, "documentId"));
  const slotId = String(Reflect.get(body, "slotId"));
  const writeHeader = assertOptionalWriteHeader(
    input.request.stagedBlob?.writeHeader,
    "staged blob write header",
  );
  const event = assertAccessEvent(
    input.request.event,
    "blob attachment bind event",
  );
  const targets = input.request.contentKeyBundle.targets.map((target) => ({
    bindingId: target.bindingId,
    documentId: target.documentId,
    containerId: target.containerId,
    containerManifestHash: target.containerManifestHash,
    containerKeyEpochId: target.containerKeyEpochId,
    containerKeyEpoch: target.containerKeyEpoch,
  }));
  const organizationId = String(
    Reflect.get(input.documentManifest.state, "organizationId"),
  );
  const linkedContainerManifestHashes = uniqueSortedStrings(
    targets.map((target) => target.containerManifestHash),
  );
  const linkedContainerKeyEpochIds = uniqueSortedStrings(
    targets.map((target) => target.containerKeyEpochId),
  );
  const blobKekTargets = {
    blobId: input.blobId,
    organizationId,
    activeBindingIds: [bindingId],
    documentManifestHashes: [input.documentManifest.manifestHash],
    linkedContainerManifestHashes,
    linkedContainerKeyEpochIds,
    targets,
    blobKeyTargetHash: input.request.contentKeyBundle.targetHash,
    blobAccessManifestHash: await computeBlobAccessManifestHash({
      version: 1,
      blobId: input.blobId,
      organizationId,
      activeBindingIds: [bindingId],
      documentManifestHashes: [input.documentManifest.manifestHash],
      linkedContainerManifestHashes,
      linkedContainerKeyEpochIds,
      blobKeyTargetHash: input.request.contentKeyBundle.targetHash,
    }),
  };

  return {
    bindingEvent: {
      body: input.request.body,
      event: input.request.event,
      eventHash: await computeAccessEventHash(event),
    },
    bindingId,
    blobId: input.blobId,
    documentId,
    documentManifestHash: input.documentManifest.manifestHash,
    previousBindingId:
      typeof Reflect.get(body, "expectedBindingId") === "string"
        ? String(Reflect.get(body, "expectedBindingId"))
        : null,
    slotId,
    contentKeyBundle: {
      blobId: input.blobId,
      contentKeyEpoch: input.request.contentKeyBundle.contentKeyEpoch,
      targetHash: input.request.contentKeyBundle.targetHash,
      targets: input.request.contentKeyBundle.targets,
    },
    blobKekTargets,
    ...(writeHeader
      ? {
          writeAuthorization: blobKekTargets,
          writeHeader: { ...writeHeader },
          writeHeaderHash: await computeWriteHeaderHash(writeHeader),
        }
      : {}),
  };
}

export interface DocumentRuntimePatch {
  apiClient: DocumentsRuntimeInput["apiClient"];
  organizationId: string;
  signingFingerprint: string;
  signingKeyPair: NonNullable<
    DocumentsRuntimeInput["crypto"]["signingKeyPair"]
  >;
  userId: string;
}

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
} from "@tearleads/client-sdk";
import {
  computeAccessEventHash,
  computeBlobAccessManifestHash,
  computeWriteHeaderHash,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { createDocument, exportAllUpdates } from "@tearleads/loro";
import {
  createContainerWriterProjectionFixture,
  createMockApiClient,
} from "@tearleads/test-utils";
import type {
  BlobAttachmentBindRequest,
  DocumentCreateRequest,
  DocumentSyncRequest,
} from "@tearleads/validators/request";
import type {
  ContainerWriterProjectionResponse,
  DocumentCreateResponse,
  DocumentSyncResponse,
  ListContainersResponse,
} from "@tearleads/validators/response";
import { APP_DOCUMENT_PROJECTOR_DEFINITIONS } from "../../../src/document-types/projectors";
import {
  assertAccessEvent,
  assertOptionalWriteHeader,
  assertWriteHeader,
} from "../keyingAssertions";

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
  state?: Partial<DocumentsRuntimeInput["state"]>;
  util?: Partial<DocumentsRuntimeInput["util"]>;
};

export interface ContentRecordFields {
  ciphertext?: unknown;
  contentRecordId?: unknown;
  iv?: unknown;
  nonceDomainHash?: unknown;
}

export interface PendingUpdateLengthRow {
  update_data_length: number | string | null;
}

export interface ProjectionLengthRow {
  text_length: number | string | null;
}

export function createListedContainers(
  containerId: string,
  metadataAccessStateHash = `${containerId}-access-state-hash-1`,
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
        organizationId: "org-1",
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
    getBlob: async () => null,
    getEncapsulationKey: async () => null,
    getContainerWriterProjection: async () => null,
    getDocumentWriterProjection: async () => null,
    listContainers: async () => createListedContainers(containerId),
    listDocumentAttachments: async () => null,
    stageBlob: async () => null,
    syncDocument: async () => null,
  });
}

export function createDocumentsRuntimeInput(
  overrides: DocumentsRuntimeInputOverrides = {},
): DocumentsRuntimeInput {
  return {
    apiClient:
      overrides.apiClient ??
      createUnavailableDocumentsApiClient("root-container"),
    auth: {
      isAuthenticated: false,
      organizationId: null,
      userId: null,
      ...overrides.auth,
    },
    crypto: {
      encapsulationKeyPair: null,
      signingFingerprint: null,
      signingKeyPair: null,
      ...overrides.crypto,
    },
    infra: {
      blobStore: createMemoryBlobStore(),
      dbStatus: "ready",
      documentProjectors: APP_DOCUMENT_PROJECTOR_DEFINITIONS,
      execSql: async () => [],
      ...overrides.infra,
    },
    state: {
      containerId: "root-container",
      domainScope: createDomainScope(),
      events: [],
      online: false,
      ...overrides.state,
    },
    util: {
      cacheReferencedPrincipalPolicies: async () => {},
      log: () => {},
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

export async function createPersistedDocumentSnapshot(
  text: string,
): Promise<string> {
  const doc = await createDocument("persisted-document-fixture");
  doc.getText("text").update(text);
  return bytesToBase64(exportAllUpdates(doc));
}

export async function createDocumentContainerProjection(input: {
  containerId: string;
  encapsulationPublicKey: Uint8Array;
  signerKeyFingerprint: string;
  signerPrivateKey: Uint8Array;
  userId: string;
}): Promise<ContainerWriterProjectionResponse> {
  return createContainerWriterProjectionFixture({
    containerId: input.containerId,
    encapsulationPublicKey: input.encapsulationPublicKey,
    organizationId: "organization-1",
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
    documentId: input.storedDocument.id,
    documentKekTargets: input.storedDocument.documentKekTargets,
    updates,
  };
}

function uniqueSortedStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

export async function createDocumentAttachmentBindResponse(input: {
  blobId: string;
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
  const targets = input.request.contentKeyBundle.targets.map((target) => ({
    bindingId: target.bindingId,
    documentId: target.documentId,
    containerId: target.containerId,
    containerManifestHash: target.containerManifestHash,
    containerKeyEpochId: target.containerKeyEpochId,
    containerKeyEpoch: target.containerKeyEpoch,
  }));

  return {
    bindingId,
    blobId: input.blobId,
    documentId,
    slotId,
    contentKeyBundle: {
      blobId: input.blobId,
      contentKeyEpoch: input.request.contentKeyBundle.contentKeyEpoch,
      targetHash: input.request.contentKeyBundle.targetHash,
      targets: input.request.contentKeyBundle.targets,
    },
    blobKekTargets: {
      blobId: input.blobId,
      organizationId: String(
        Reflect.get(input.request.documentManifest.state, "organizationId"),
      ),
      activeBindingIds: [bindingId],
      documentManifestHashes: [input.request.documentManifest.manifestHash],
      linkedContainerManifestHashes: uniqueSortedStrings(
        targets.map((target) => target.containerManifestHash),
      ),
      linkedContainerKeyEpochIds: uniqueSortedStrings(
        targets.map((target) => target.containerKeyEpochId),
      ),
      targets,
      blobKeyTargetHash: input.request.contentKeyBundle.targetHash,
      blobAccessManifestHash: await computeBlobAccessManifestHash({
        version: 1,
        blobId: input.blobId,
        organizationId: String(
          Reflect.get(input.request.documentManifest.state, "organizationId"),
        ),
        activeBindingIds: [bindingId],
        documentManifestHashes: [input.request.documentManifest.manifestHash],
        linkedContainerManifestHashes: uniqueSortedStrings(
          targets.map((target) => target.containerManifestHash),
        ),
        linkedContainerKeyEpochIds: uniqueSortedStrings(
          targets.map((target) => target.containerKeyEpochId),
        ),
        blobKeyTargetHash: input.request.contentKeyBundle.targetHash,
      }),
    },
    ...(writeHeader
      ? { writeHeaderHash: await computeWriteHeaderHash(writeHeader) }
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

export function documentProjectionRuntimeFromPatch(
  patch: DocumentRuntimePatch,
  encapsulationKeyPair: NonNullable<
    DocumentsRuntimeInput["crypto"]["encapsulationKeyPair"]
  >,
) {
  return {
    apiClient: patch.apiClient,
    auth: {
      userId: patch.userId,
    },
    crypto: {
      encapsulationKeyPair,
      signingFingerprint: patch.signingFingerprint,
      signingKeyPair: patch.signingKeyPair,
    },
  };
}

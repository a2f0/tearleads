import { expect, test } from "bun:test";
import {
  computeAccessEventHash,
  computeBlobAccessManifestHash,
  computeWriteHeaderHash,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { createDocument, exportAllUpdates } from "@tearleads/loro";
import { createLargeText } from "@tearleads/test-utils";
import { isPlainObject } from "@tearleads/validators/isPlainObject";
import type {
  BlobAttachmentBindRequest,
  DocumentCreateRequest,
  DocumentSyncRequest,
  StageBlobRequest,
} from "@tearleads/validators/request";
import type {
  BlobAttachmentBindResponse,
  ContainerWriterProjectionResponse,
  DocumentCreateResponse,
  DocumentSyncResponse,
  DocumentWriterProjectionResponse,
  ListContainersResponse,
} from "@tearleads/validators/response";
import { createContainerWriterProjectionFixture } from "../../../../test/helpers/createContainerWriterProjectionFixture";
import { createMockApiClient } from "../../../../test/helpers/createMockApiClient";
import { createSqlRuntimeBase } from "../../../../test/helpers/createSqlRuntime";
import {
  assertAccessEvent,
  assertOptionalWriteHeader,
  assertWriteHeader,
} from "../../../../test/helpers/keyingAssertions";
import { waitForCondition } from "../../../../test/helpers/waitForCondition";
import { type BlobBytes, createMemoryBlobStore } from "../../../data/blobs";
import type { DocumentSummary } from "../../../data/documentSummary";
import { createProjectionUserKeyResolver } from "../../../data/keyingProjectionVerification";
import { DOCUMENTS_APP_KIND } from "../../../data/persistence/documents/documentsPersistence";
import { getOrCreateDomainSyncCoordinator } from "../../../data/sync/syncCoordinator";
import {
  decryptDocumentAttachmentBlob,
  uploadDocumentAttachment,
} from "../../../workflows/blobs";
import {
  createDocumentsWorkflowRuntime,
  createRemoteDocument,
  type DocumentRecord,
  type DocumentsPersistence,
  type LocalAttachmentRecord,
  type PendingAttachmentRecord,
  type PendingUpdateInsert,
  type PendingUpdateRecord,
} from "../../../workflows/documents";
import {
  createDocumentStore,
  type DocumentsRuntime,
  primeDocumentStore,
  subscribeToPersistedDocuments,
} from "../DocumentsProvider";

interface StoredDocumentsState {
  document: DocumentRecord | null;
  documentSummaries: DocumentSummary[];
  localAttachments: LocalAttachmentRecord[];
  pendingAttachments: PendingAttachmentRecord[];
  pendingUpdates: PendingUpdateRecord[];
}

type DocumentsRuntimeInput = Parameters<
  typeof createDocumentsWorkflowRuntime
>[0];
type DocumentsTestRuntime = DocumentsRuntime &
  Pick<
    DocumentsRuntimeInput,
    "apiClient" | "blobStore" | "cacheReferencedPrincipalPolicies" | "execSql"
  >;

interface ContentRecordFields {
  ciphertext?: unknown;
  contentRecordId?: unknown;
  iv?: unknown;
  nonceDomainHash?: unknown;
}

interface PendingUpdateLengthRow {
  update_data_length: number | string | null;
}

interface ProjectionLengthRow {
  text_length: number | string | null;
}

function createListedContainers(
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

function createUnavailableDocumentsApiClient(
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

function createDocumentsTestRuntime(
  input: DocumentsRuntimeInput,
): DocumentsTestRuntime {
  return {
    ...createDocumentsWorkflowRuntime(input),
    apiClient: input.apiClient,
    blobStore: input.blobStore,
    cacheReferencedPrincipalPolicies: input.cacheReferencedPrincipalPolicies,
    execSql: input.execSql,
  };
}

function cloneDocumentsTestRuntime(
  runtime: DocumentsTestRuntime,
  overrides: Partial<DocumentsRuntimeInput>,
): DocumentsTestRuntime {
  return createDocumentsTestRuntime({
    apiClient: overrides.apiClient ?? runtime.apiClient,
    blobStore: overrides.blobStore ?? runtime.blobStore,
    cacheReferencedPrincipalPolicies:
      overrides.cacheReferencedPrincipalPolicies ??
      runtime.cacheReferencedPrincipalPolicies,
    containerId:
      (Object.hasOwn(overrides, "containerId")
        ? overrides.containerId
        : runtime.containerId) ?? null,
    dbStatus: overrides.dbStatus ?? runtime.dbStatus,
    domainScope: overrides.domainScope ?? runtime.domainScope,
    encapsulationKeyPair: Object.hasOwn(overrides, "encapsulationKeyPair")
      ? overrides.encapsulationKeyPair
      : runtime.encapsulationKeyPair,
    events: overrides.events ?? runtime.events,
    execSql: overrides.execSql ?? runtime.execSql,
    isAuthenticated: overrides.isAuthenticated ?? runtime.isAuthenticated,
    log: overrides.log ?? runtime.log,
    online: overrides.online ?? runtime.online,
    organizationId:
      (Object.hasOwn(overrides, "organizationId")
        ? overrides.organizationId
        : runtime.organizationId) ?? null,
    signingFingerprint:
      (Object.hasOwn(overrides, "signingFingerprint")
        ? overrides.signingFingerprint
        : runtime.signingFingerprint) ?? null,
    signingKeyPair:
      (Object.hasOwn(overrides, "signingKeyPair")
        ? overrides.signingKeyPair
        : runtime.signingKeyPair) ?? null,
    userId:
      (Object.hasOwn(overrides, "userId")
        ? overrides.userId
        : runtime.userId) ?? null,
  });
}

async function createPersistedDocumentSnapshot(text: string): Promise<string> {
  const doc = await createDocument("persisted-document-fixture");
  doc.getText("text").update(text);
  return bytesToBase64(exportAllUpdates(doc));
}

async function createDocumentContainerProjection(input: {
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

async function createDocumentCreateResponse(
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

async function createDocumentSyncResponse(input: {
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

function uniqueSortedStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

async function createDocumentAttachmentBindResponse(input: {
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

interface DocumentRuntimePatch {
  apiClient: DocumentsRuntimeInput["apiClient"];
  organizationId: string;
  signingFingerprint: string;
  signingKeyPair: NonNullable<DocumentsRuntimeInput["signingKeyPair"]>;
  userId: string;
}

function createDocumentProjectionUserKeyResolver(
  runtimePatch: DocumentRuntimePatch,
) {
  return createProjectionUserKeyResolver(
    runtimePatch,
    "DocumentStore sync test",
  );
}

async function createDocumentRuntimePatch(input: {
  attachmentBinds?: Array<{
    blobId: string;
    request: BlobAttachmentBindRequest;
  }>;
  containerId?: string;
  encapsulationKeyPair: NonNullable<
    DocumentsRuntimeInput["encapsulationKeyPair"]
  >;
  onBindBlobAttachment?: (
    blobId: string,
    request: BlobAttachmentBindRequest,
  ) => Promise<void> | void;
  mapBindBlobAttachmentResponse?: (
    response: BlobAttachmentBindResponse,
  ) => BlobAttachmentBindResponse;
  mapDocumentWriterProjectionResponse?: (
    response: DocumentWriterProjectionResponse,
  ) => DocumentWriterProjectionResponse;
  commitLsnForSyncCount?: (syncCount: number) => string;
  syncCalls?: Array<{ minLsn: string | null; outgoingUpdateCount: number }>;
}): Promise<DocumentRuntimePatch> {
  const containerId = input.containerId ?? "root-container";
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const signingFingerprint = await toFingerprint(
    signingKeyPair.signingPublicKey,
  );
  let projectionPromise: Promise<ContainerWriterProjectionResponse> | null =
    null;
  let stageCount = 0;
  let storedDocument: DocumentCreateResponse | null = null;
  let syncCount = 0;
  const attachments: Array<{
    bindingId: string;
    blobId: string;
    slotId: string;
  }> = [];
  const stagedBlobs = new Map<string, StageBlobRequest>();
  const blobs = new Map<
    string,
    {
      encryptedBytes: string;
      sha256: string;
    }
  >();
  const getProjection = () => {
    projectionPromise ??= createDocumentContainerProjection({
      containerId,
      encapsulationPublicKey: input.encapsulationKeyPair.publicKey,
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
      bindBlobAttachment: async (blobId, request) => {
        const stagedBlob = request.stagedBlob
          ? stagedBlobs.get(request.stagedBlob.stageId)
          : null;
        if (request.stagedBlob && !stagedBlob) {
          return null;
        }
        await input.onBindBlobAttachment?.(blobId, request);
        const responseFixture = await createDocumentAttachmentBindResponse({
          blobId,
          request,
        });
        const response =
          input.mapBindBlobAttachmentResponse?.(responseFixture) ??
          responseFixture;
        input.attachmentBinds?.push({ blobId, request });
        attachments.push({
          bindingId: response.bindingId,
          blobId: response.blobId,
          slotId: response.slotId,
        });
        if (stagedBlob) {
          blobs.set(blobId, {
            encryptedBytes: stagedBlob.encryptedBytes,
            sha256: stagedBlob.sha256,
          });
          stagedBlobs.delete(request.stagedBlob?.stageId ?? "");
        }
        return response;
      },
      getBlob: async (blobId) => {
        const blob = blobs.get(blobId);
        return blob ? { blobId, ...blob } : null;
      },
      getEncapsulationKey: async (userId) =>
        userId === "user-1"
          ? {
              encapsulationPublicKey: bytesToBase64(
                input.encapsulationKeyPair.publicKey,
              ),
              signingKeyFingerprint: signingFingerprint,
              signingPublicKey: bytesToBase64(signingKeyPair.signingPublicKey),
              userId,
            }
          : null,
      getContainerWriterProjection: () => getProjection(),
      getDocumentWriterProjection: async () => {
        if (!storedDocument) {
          return null;
        }
        const projection = {
          authorizingContainerPaths: [await getProjection()],
          contentKeyBundle: storedDocument.contentKeyBundle,
          documentId: storedDocument.id,
          documentKekTargets: storedDocument.documentKekTargets,
          documentManifest: storedDocument.accessManifest,
        };
        return (
          input.mapDocumentWriterProjectionResponse?.(projection) ?? projection
        );
      },
      listContainers: async () => createListedContainers(containerId),
      listDocumentAttachments: async () => attachments,
      stageBlob: async (request) => {
        stageCount += 1;
        const stageId = `stage-${stageCount}`;
        stagedBlobs.set(stageId, request);
        return {
          stageId,
          expiresAt: "2026-04-27T00:05:00.000Z",
        };
      },
      syncDocument: async (_documentId, request) => {
        if (!storedDocument) {
          return null;
        }
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
    organizationId: "organization-1",
    signingFingerprint,
    signingKeyPair,
    userId: "user-1",
  };
}

interface PendingUpdateDetailRow extends PendingUpdateLengthRow {
  partial_start_version_vector: string | null;
  partial_end_version_vector: string | null;
}

function readRowValue(value: unknown, key: string): unknown {
  return isPlainObject(value) ? value[key] : undefined;
}

function isPendingUpdateLengthRow(
  value: unknown,
): value is PendingUpdateLengthRow {
  const updateDataLength = readRowValue(value, "update_data_length");
  return (
    typeof updateDataLength === "number" ||
    typeof updateDataLength === "string" ||
    updateDataLength === null
  );
}

function isProjectionLengthRow(value: unknown): value is ProjectionLengthRow {
  const textLength = readRowValue(value, "text_length");
  return (
    typeof textLength === "number" ||
    typeof textLength === "string" ||
    textLength === null
  );
}

function isPendingUpdateDetailRow(
  value: unknown,
): value is PendingUpdateDetailRow {
  const partialStartVersionVector = readRowValue(
    value,
    "partial_start_version_vector",
  );
  const partialEndVersionVector = readRowValue(
    value,
    "partial_end_version_vector",
  );

  return (
    isPendingUpdateLengthRow(value) &&
    (typeof partialStartVersionVector === "string" ||
      partialStartVersionVector === null) &&
    (typeof partialEndVersionVector === "string" ||
      partialEndVersionVector === null)
  );
}

function createDocumentsPersistence(): DocumentsPersistence & {
  getState: () => StoredDocumentsState;
} {
  let document: DocumentRecord | null = null;
  let localAttachments: LocalAttachmentRecord[] = [];
  let pendingAttachments: PendingAttachmentRecord[] = [];
  let pendingUpdates: PendingUpdateRecord[] = [];

  return {
    async ensureSchema() {},
    getState() {
      return {
        document,
        documentSummaries: document
          ? [
              {
                id: document.id,
                containerId: document.containerId,
                documentId: document.documentId,
                title: document.text.trim() || "Untitled note",
                updatedAt: "2026-04-06T00:00:00.000Z",
              },
            ]
          : [],
        localAttachments,
        pendingAttachments,
        pendingUpdates,
      };
    },
    async listDocuments() {
      return document
        ? [
            {
              id: document.id,
              containerId: document.containerId,
              documentId: document.documentId,
              title: document.text.trim() || "Untitled note",
              updatedAt: "2026-04-06T00:00:00.000Z",
            },
          ]
        : [];
    },
    async listDocumentsByContainerIdsOrDocumentIds(_execSql, input) {
      if (!document) {
        return [];
      }

      const containerIds = new Set(input.containerIds);
      const documentIds = new Set(input.documentIds);
      const containerMatches =
        document.containerId !== null && containerIds.has(document.containerId);
      const documentMatches =
        document.documentId !== null && documentIds.has(document.documentId);
      if (!containerMatches && !documentMatches) {
        return [];
      }

      return [
        {
          id: document.id,
          containerId: document.containerId,
          documentId: document.documentId,
          title: document.text.trim() || "Untitled note",
          updatedAt: "2026-04-06T00:00:00.000Z",
        },
      ];
    },
    async loadDocument() {
      return document;
    },
    async saveDocument(_execSql, nextDocument) {
      document = nextDocument;
      return "2026-04-06T00:00:00.000Z";
    },
    async saveDocumentAndDeletePendingUpdates(
      _execSql,
      nextDocument,
      pendingUpdateIds,
    ) {
      const acceptedPendingUpdateIds = new Set(pendingUpdateIds);
      document = nextDocument;
      pendingUpdates = pendingUpdates.filter(
        (pendingUpdate) => !acceptedPendingUpdateIds.has(pendingUpdate.id),
      );
      return "2026-04-06T00:00:00.000Z";
    },
    async upsertDiscoveredDocument(_execSql, input) {
      const nextDocument = {
        accessEpoch: input.accessEpoch,
        containerId: input.containerId,
        documentId: input.documentId,
        id: document?.id ?? input.documentId,
        loroSnapshot: document?.loroSnapshot ?? "",
        text: document?.text ?? "",
      };
      document = nextDocument;

      return {
        id: nextDocument.id,
        containerId: nextDocument.containerId,
        documentId: nextDocument.documentId,
        title: nextDocument.text.trim() || "Untitled note",
        updatedAt: input.createdAt,
      };
    },
    async relinkPersistedDocument(_execSql, input) {
      if (!document || document.id !== input.localId) {
        return null;
      }

      document = {
        ...document,
        accessEpoch: Math.max(document.accessEpoch, input.accessEpoch),
        containerId: input.containerId,
        documentId: input.documentId,
      };

      return {
        id: document.id,
        containerId: document.containerId,
        documentId: document.documentId,
        title: document.text.trim() || "Untitled note",
        updatedAt: "2026-04-06T00:00:00.000Z",
      };
    },
    async listPendingUpdates() {
      return pendingUpdates;
    },
    async listPendingAttachments() {
      return pendingAttachments;
    },
    async listLocalAttachments() {
      return localAttachments;
    },
    async enqueuePendingUpdate(_execSql, pendingUpdate: PendingUpdateInsert) {
      pendingUpdates = [
        ...pendingUpdates,
        {
          id: crypto.randomUUID(),
          partialEndVersionVector: pendingUpdate.partialEndVersionVector,
          partialStartVersionVector: pendingUpdate.partialStartVersionVector,
          sourceVersionVector: pendingUpdate.sourceVersionVector ?? null,
          updateData: pendingUpdate.updateData,
        },
      ];
    },
    async deletePendingUpdate(_execSql, id: string) {
      pendingUpdates = pendingUpdates.filter(
        (pendingUpdate) => pendingUpdate.id !== id,
      );
    },
    async deletePendingUpdates() {
      pendingUpdates = [];
    },
    async deletePendingAttachment(_execSql, localId, slotId, storageKey) {
      pendingAttachments = pendingAttachments.filter(
        (attachment) =>
          !(
            attachment.localId === localId &&
            attachment.slotId === slotId &&
            attachment.storageKey === storageKey
          ),
      );
    },
    async saveLocalAttachment(_execSql, attachment) {
      localAttachments = [
        ...localAttachments.filter(
          (existingAttachment) =>
            !(
              existingAttachment.localId === attachment.localId &&
              existingAttachment.slotId === attachment.slotId
            ),
        ),
        attachment,
      ];
    },
    async deleteLocalAttachment(_execSql, localId, slotId, storageKey) {
      localAttachments = localAttachments.filter(
        (attachment) =>
          !(
            attachment.localId === localId &&
            attachment.slotId === slotId &&
            attachment.storageKey === storageKey
          ),
      );
    },
    async savePendingAttachment(_execSql, attachment) {
      pendingAttachments = [
        ...pendingAttachments.filter(
          (existingAttachment) =>
            !(
              existingAttachment.localId === attachment.localId &&
              existingAttachment.slotId === attachment.slotId
            ),
        ),
        attachment,
      ];
    },
    async deletePendingAttachments(_execSql, localId) {
      pendingAttachments = pendingAttachments.filter(
        (attachment) => attachment.localId !== localId,
      );
    },
  };
}

function createRuntime(containerId = "root-container"): DocumentsTestRuntime {
  return createDocumentsTestRuntime({
    apiClient: createUnavailableDocumentsApiClient(containerId),
    blobStore: createMemoryBlobStore(),
    cacheReferencedPrincipalPolicies: async () => {},
    containerId,
    dbStatus: "ready",
    domainScope: {},
    encapsulationKeyPair: null,
    events: [],
    execSql: async () => [],
    isAuthenticated: false,
    log: () => {},
    online: false,
  });
}

async function createSyncRuntimeInput(
  encapsulationKeyPair: NonNullable<
    DocumentsRuntimeInput["encapsulationKeyPair"]
  >,
  containerId = "root-container",
  options: {
    attachmentBinds?: Array<{
      blobId: string;
      request: BlobAttachmentBindRequest;
    }>;
    commitLsnForSyncCount?: (syncCount: number) => string;
    onBindBlobAttachment?: (
      blobId: string,
      request: BlobAttachmentBindRequest,
    ) => Promise<void> | void;
    syncCalls?: Array<{ minLsn: string | null; outgoingUpdateCount: number }>;
  } = {},
): Promise<DocumentsRuntimeInput> {
  const patch = await createDocumentRuntimePatch({
    containerId,
    encapsulationKeyPair,
    ...(options.attachmentBinds
      ? { attachmentBinds: options.attachmentBinds }
      : {}),
    ...(options.commitLsnForSyncCount
      ? { commitLsnForSyncCount: options.commitLsnForSyncCount }
      : {}),
    ...(options.onBindBlobAttachment
      ? { onBindBlobAttachment: options.onBindBlobAttachment }
      : {}),
    ...(options.syncCalls ? { syncCalls: options.syncCalls } : {}),
  });
  return {
    apiClient: patch.apiClient,
    blobStore: createMemoryBlobStore(),
    cacheReferencedPrincipalPolicies: async () => {},
    containerId,
    dbStatus: "ready",
    domainScope: {},
    encapsulationKeyPair,
    events: [],
    execSql: async () => [],
    isAuthenticated: true,
    log: () => {},
    online: true,
    organizationId: patch.organizationId,
    signingFingerprint: patch.signingFingerprint,
    signingKeyPair: patch.signingKeyPair,
    userId: patch.userId,
  };
}

async function createSyncRuntime(
  encapsulationKeyPair: NonNullable<
    DocumentsRuntimeInput["encapsulationKeyPair"]
  >,
  containerId = "root-container",
  options: {
    attachmentBinds?: Array<{
      blobId: string;
      request: BlobAttachmentBindRequest;
    }>;
    commitLsnForSyncCount?: (syncCount: number) => string;
    onBindBlobAttachment?: (
      blobId: string,
      request: BlobAttachmentBindRequest,
    ) => Promise<void> | void;
    syncCalls?: Array<{ minLsn: string | null; outgoingUpdateCount: number }>;
  } = {},
): Promise<DocumentsTestRuntime> {
  return createDocumentsTestRuntime(
    await createSyncRuntimeInput(encapsulationKeyPair, containerId, options),
  );
}

function createOfflineAttachmentRuntime(
  encapsulationKeyPair: NonNullable<
    DocumentsRuntimeInput["encapsulationKeyPair"]
  >,
  containerId = "root-container",
): DocumentsTestRuntime {
  return createDocumentsTestRuntime({
    apiClient: createUnavailableDocumentsApiClient(containerId),
    blobStore: createMemoryBlobStore(),
    cacheReferencedPrincipalPolicies: async () => {},
    containerId,
    dbStatus: "ready",
    domainScope: {},
    encapsulationKeyPair,
    events: [],
    execSql: async () => [],
    isAuthenticated: false,
    log: () => {},
    online: false,
  });
}

async function waitForStoredDocumentText(
  runtime: DocumentsTestRuntime,
  localId: string,
  text: string,
) {
  await waitForCondition(async () => {
    const rows = await runtime.execSql(
      `
 SELECT text
 FROM document_projection
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

async function createSqlRuntime(): Promise<
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
      containerId: "root-container",
    }),
    close,
  };
}

test("primeDocumentStore reuses a synced remote note across different local ids", async () => {
  const runtimeBase = await createSqlRuntime();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const patch = await createDocumentRuntimePatch({
    encapsulationKeyPair,
  });
  const runtime = cloneDocumentsTestRuntime(runtimeBase, {
    apiClient: patch.apiClient,
    encapsulationKeyPair,
    isAuthenticated: true,
    online: true,
    organizationId: patch.organizationId,
    signingFingerprint: patch.signingFingerprint,
    signingKeyPair: patch.signingKeyPair,
    userId: patch.userId,
  });

  try {
    const firstStore = primeDocumentStore(
      runtime.domainScope,
      "note-1",
      runtime,
    );
    await waitForCondition(
      () => firstStore.getSnapshot().ready,
      "First primed document store did not initialize.",
    );

    firstStore.setText("Shared note");
    await waitForStoredDocumentText(runtime, "note-1", "Shared note");
    await waitForCondition(
      () => firstStore.getSnapshot().documentId !== null,
      "First primed document store did not persist its remote document id.",
    );
    const remoteDocumentId = firstStore.getSnapshot().documentId;
    if (!remoteDocumentId) {
      throw new Error("Expected first store to have a remote document id.");
    }

    const secondStore = primeDocumentStore(
      runtime.domainScope,
      "default",
      runtime,
      remoteDocumentId,
    );

    expect(secondStore).toBe(firstStore);
    expect(secondStore.getSnapshot().text).toBe("Shared note");
    await waitForCondition(
      () => !firstStore.getSnapshot().syncing,
      "Shared document store did not finish syncing before cleanup.",
    );
  } finally {
    runtimeBase.close();
  }
});

test("primeDocumentStore collapses live duplicate document facades after remote identity resolves", async () => {
  const runtimeBase = await createSqlRuntime();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const patch = await createDocumentRuntimePatch({
    encapsulationKeyPair,
  });
  const runtime = cloneDocumentsTestRuntime(runtimeBase, {
    apiClient: patch.apiClient,
    encapsulationKeyPair,
    isAuthenticated: true,
    online: true,
    organizationId: patch.organizationId,
    signingFingerprint: patch.signingFingerprint,
    signingKeyPair: patch.signingKeyPair,
    userId: patch.userId,
  });

  try {
    const firstStore = primeDocumentStore(
      runtime.domainScope,
      "note-1",
      runtime,
    );
    const secondStore = primeDocumentStore(
      runtime.domainScope,
      "default",
      runtime,
      "shared-remote-note",
    );

    expect(secondStore).not.toBe(firstStore);

    await waitForCondition(
      () => firstStore.getSnapshot().ready && secondStore.getSnapshot().ready,
      "Duplicate document facades did not initialize before consolidation.",
    );

    await firstStore.relink({
      accessEpoch: 1,
      accessStateHash: "shared-note-access-state",
      containerId: "root-container",
      documentId: "shared-remote-note",
      localId: "note-1",
    });
    firstStore.setText("Shared note");
    await waitForStoredDocumentText(runtime, "note-1", "Shared note");

    await waitForCondition(
      () =>
        secondStore.getSnapshot().documentId === "shared-remote-note" &&
        secondStore.getSnapshot().text === "Shared note",
      "Live duplicate document facades did not collapse onto the same backing store.",
    );

    secondStore.setText("Merged note");
    await waitForStoredDocumentText(runtime, "note-1", "Merged note");

    await waitForCondition(
      () => firstStore.getSnapshot().text === "Merged note",
      "Collapsed document facades did not share subsequent updates.",
    );
    await waitForCondition(
      () =>
        !firstStore.getSnapshot().syncing && !secondStore.getSnapshot().syncing,
      "Collapsed document facades did not finish syncing before cleanup.",
    );
  } finally {
    runtimeBase.close();
  }
});

test("domain-scoped persisted document subscriptions fan out to multiple listeners", async () => {
  const persistence = createDocumentsPersistence();
  const runtime = createRuntime();
  const firstListenerDocuments: DocumentSummary[] = [];
  const secondListenerDocuments: DocumentSummary[] = [];
  const unsubscribeFirst = subscribeToPersistedDocuments(
    runtime.domainScope,
    (document) => {
      firstListenerDocuments.push(document);
    },
  );
  const unsubscribeSecond = subscribeToPersistedDocuments(
    runtime.domainScope,
    (document) => {
      secondListenerDocuments.push(document);
    },
  );

  try {
    const store = createDocumentStore("shared-listeners", runtime, persistence);
    store.updateRuntime(runtime);

    await waitForCondition(
      () => store.getSnapshot().ready,
      "Document store did not become ready before broadcasting persisted updates.",
    );

    store.setText("Shared note");

    await waitForCondition(
      () =>
        firstListenerDocuments.some(
          (document) => document.title === "Shared note",
        ) &&
        secondListenerDocuments.some(
          (document) => document.title === "Shared note",
        ),
      "Persisted document listeners did not all receive the saved document summary.",
    );
  } finally {
    unsubscribeFirst();
    unsubscribeSecond();
  }
});

test("document store re-registers sync lane when runtime domain scope changes", async () => {
  const persistence = createDocumentsPersistence();
  const firstRuntime = createRuntime();
  const secondRuntime = cloneDocumentsTestRuntime(firstRuntime, {
    domainScope: {},
  });
  const store = createDocumentStore(
    "domain-scope-note",
    firstRuntime,
    persistence,
  );
  store.updateRuntime(firstRuntime);

  await waitForCondition(
    () => store.getSnapshot().ready,
    "Document store did not become ready before the domain scope changed.",
  );

  store.updateRuntime(secondRuntime);

  let oldDomainSyncRequested = false;
  let nextDomainSyncRequested = false;
  getOrCreateDomainSyncCoordinator(firstRuntime.domainScope).registerLane(
    "documents:domain-scope-note",
    {
      run: async () => {
        oldDomainSyncRequested = true;
      },
    },
  );
  getOrCreateDomainSyncCoordinator(secondRuntime.domainScope).registerLane(
    "documents:domain-scope-note",
    {
      run: async () => {
        nextDomainSyncRequested = true;
      },
    },
  );

  store.requestSync();

  await waitForCondition(
    () => nextDomainSyncRequested,
    "Document store did not request sync through the updated domain scope.",
  );
  expect(oldDomainSyncRequested).toBe(false);
});

test("document store reloads persisted note text and pending updates", async () => {
  const persistence = createDocumentsPersistence();

  const firstRuntime = createRuntime();
  const firstStore = createDocumentStore("default", firstRuntime, persistence);
  firstStore.updateRuntime(firstRuntime);

  await waitForCondition(
    () => firstStore.getSnapshot().ready,
    "First document store did not become ready.",
  );

  expect(firstStore.getSnapshot()).toEqual({
    attachments: [],
    attachmentStatusBySlotId: {},
    attachmentStorageKeyBySlotId: {},
    canAttach: false,
    documentId: null,
    documentKind: "note",
    fieldValidationIssues: [],
    ready: true,
    structuredFields: {},
    syncing: false,
    text: "",
    title: "Untitled note",
  });

  firstStore.setText("persisted note");

  await waitForCondition(
    () => persistence.getState().document?.text === "persisted note",
    "Persisted note text was not written.",
  );

  await waitForCondition(
    () => persistence.getState().pendingUpdates.length === 1,
    "Pending note update was not enqueued.",
  );

  const secondRuntime = createRuntime();
  const secondStore = createDocumentStore(
    "default",
    secondRuntime,
    persistence,
  );
  secondStore.updateRuntime(secondRuntime);

  await waitForCondition(
    () => secondStore.getSnapshot().ready,
    "Second document store did not become ready.",
  );

  expect(secondStore.getSnapshot()).toEqual({
    attachments: [],
    attachmentStatusBySlotId: {},
    attachmentStorageKeyBySlotId: {},
    canAttach: false,
    documentId: null,
    documentKind: "note",
    fieldValidationIssues: [],
    ready: true,
    structuredFields: {},
    syncing: false,
    text: "persisted note",
    title: "persisted note",
  });
});

test("document store creates a document linked to the configured container", async () => {
  const persistence = createDocumentsPersistence();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const runtime = await createSyncRuntime(
    encapsulationKeyPair,
    "shared-container",
  );

  const store = createDocumentStore("container-note", runtime, persistence);
  store.updateRuntime(runtime);

  await waitForCondition(
    () => store.getSnapshot().ready,
    "Container-scoped document store did not become ready.",
  );

  store.setText("shared container note");

  await waitForCondition(
    () =>
      persistence.getState().pendingUpdates.length === 0 &&
      persistence.getState().document?.documentId !== null &&
      persistence.getState().document?.containerId === "shared-container" &&
      persistence.getState().document?.contentKeyBundle !== null &&
      persistence.getState().document?.documentKekTargets !== null &&
      persistence.getState().document?.documentManifestBundle !== null &&
      !store.getSnapshot().syncing,
    "Container-scoped note did not create and sync its document.",
  );
});

test("document store clears document state when access epoch changes", async () => {
  const persistence = createDocumentsPersistence();
  const runtime = createRuntime();

  await persistence.saveDocument(runtime.execSql, {
    accessEpoch: 1,
    accessStateHash: "access-state-hash-1",
    containerId: "container-a",
    documentId: "remote-document",
    id: "epoch-note",
    lastCommitLsn: "0/10",
    loroSnapshot: await createPersistedDocumentSnapshot("Existing note"),
    text: "Existing note",
    contentKeyBundle: "stale-content-key-bundle",
    documentKekTargets: "stale-kek-targets",
    documentManifestBundle: "stale-manifest-bundle",
  });

  const store = createDocumentStore("epoch-note", runtime, persistence);
  store.updateRuntime(runtime);

  await waitForCondition(
    () => store.getSnapshot().ready,
    "Epoch relink document store did not become ready.",
  );

  await expect(
    store.relink({
      accessEpoch: 2,
      accessStateHash: "access-state-hash-2",
      containerId: "container-b",
      documentId: "remote-document",
      localId: "epoch-note",
    }),
  ).resolves.toMatchObject({
    accessStateHash: "access-state-hash-2",
    containerId: "container-b",
    documentId: "remote-document",
    id: "epoch-note",
  });

  expect(persistence.getState().document).toMatchObject({
    accessEpoch: 2,
    accessStateHash: "access-state-hash-2",
    containerId: "container-b",
    documentId: "remote-document",
    lastCommitLsn: "0/10",
    contentKeyBundle: null,
    documentKekTargets: null,
    documentManifestBundle: null,
  });
});

test("document store attaches files locally without authentication or network", async () => {
  const persistence = createDocumentsPersistence();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const blobStore = createMemoryBlobStore();
  const runtime = createOfflineAttachmentRuntime(
    encapsulationKeyPair,
    "offline-container",
  );
  const offlineRuntime = cloneDocumentsTestRuntime(runtime, {
    blobStore,
  });
  const store = createDocumentStore(
    "offline-attachment-note",
    offlineRuntime,
    persistence,
  );
  store.updateRuntime(offlineRuntime);

  await waitForCondition(
    () => store.getSnapshot().ready,
    "Offline attachment document store did not become ready.",
  );

  expect(store.getSnapshot().canAttach).toBe(true);

  store.attachFiles([
    {
      bytes: new TextEncoder().encode("offline bytes"),
      mimeType: "image/png",
      name: "offline.png",
    },
  ]);

  await waitForCondition(
    () =>
      store.getSnapshot().attachments.length === 1 &&
      persistence.getState().pendingAttachments.length === 1 &&
      persistence.getState().pendingAttachments[0]?.name === "offline.png",
    "Offline attachment was not stored locally.",
  );

  const slotId = store.getSnapshot().attachments[0]?.slotId;
  const storageKey = slotId
    ? store.getSnapshot().attachmentStorageKeyBySlotId[slotId]
    : undefined;
  const persistedBytes = storageKey
    ? await blobStore.readBytes(storageKey)
    : null;

  expect(storageKey).toBeString();
  expect(new TextDecoder().decode(persistedBytes ?? new Uint8Array())).toBe(
    "offline bytes",
  );
});

test("document store uploads attachment bytes with signed bindings", async () => {
  const persistence = createDocumentsPersistence();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const attachmentBinds: Array<{
    blobId: string;
    request: BlobAttachmentBindRequest;
  }> = [];
  const logs: string[] = [];
  const syncCalls: Array<{
    minLsn: string | null;
    outgoingUpdateCount: number;
  }> = [];
  const runtimeInput = await createSyncRuntime(
    encapsulationKeyPair,
    "shared-container",
    {
      attachmentBinds,
      syncCalls,
    },
  );
  const runtime = createDocumentsTestRuntime({
    ...runtimeInput,
    containerId: runtimeInput.containerId ?? null,
    organizationId: runtimeInput.organizationId ?? null,
    signingFingerprint: runtimeInput.signingFingerprint ?? null,
    signingKeyPair: runtimeInput.signingKeyPair ?? null,
    userId: runtimeInput.userId ?? null,
    log: (message) => logs.push(message),
  });
  const store = createDocumentStore("attachment-upload", runtime, persistence);
  store.updateRuntime(runtime);

  await waitForCondition(
    () => store.getSnapshot().ready,
    "Attachment upload document store did not become ready.",
  );

  store.attachFiles([
    {
      bytes: new TextEncoder().encode("remote attachment bytes"),
      mimeType: "image/png",
      name: "remote.png",
    },
  ]);

  await waitForCondition(
    () =>
      persistence.getState().pendingAttachments.length === 0 &&
      persistence.getState().pendingUpdates.length === 0 &&
      typeof persistence.getState().localAttachments[0]?.blobId === "string",
    "Pending attachment was not uploaded and synced.",
  );

  expect(store.getSnapshot().attachments).toHaveLength(1);
  expect(persistence.getState().pendingAttachments).toHaveLength(0);
  expect(persistence.getState().pendingUpdates).toHaveLength(0);
  expect(persistence.getState().document?.documentId).toBeString();
  expect(persistence.getState().localAttachments[0]?.blobId).toBeString();
  expect(attachmentBinds).toHaveLength(1);
  expect(attachmentBinds[0]?.request.stagedBlob?.writeHeader).toBeDefined();
  expect(attachmentBinds[0]?.request.body).toMatchObject({
    eventType: "attachment.bind",
    documentId: persistence.getState().document?.documentId,
    slotId: store.getSnapshot().attachments[0]?.slotId,
    expectedBindingId: null,
  });
  expect(syncCalls.some((call) => call.outgoingUpdateCount === 1)).toBe(true);
  expect(logs).not.toContain(
    "Documents: attachment upload sync is waiting for attachment bindings.",
  );

  const blobId = persistence.getState().localAttachments[0]?.blobId;
  const documentId = persistence.getState().document?.documentId;
  if (!blobId || !documentId) {
    throw new Error("Expected uploaded attachment and remote document ids.");
  }
  const [blob, writerProjection] = await Promise.all([
    runtime.apiClient.getBlob(blobId),
    runtime.apiClient.getDocumentWriterProjection?.(documentId),
  ]);
  if (!blob || !writerProjection) {
    throw new Error("Expected uploaded blob and writer projection fixtures.");
  }
  const resolveProjectionUserKey = runtime.createProjectionUserKeyResolver();
  const bindingId = String(
    Reflect.get(attachmentBinds[0]?.request.body ?? {}, "bindingId"),
  );
  const decryptedBytes = await decryptDocumentAttachmentBlob({
    encryptedBytes: blob.encryptedBytes,
    expectedBindingId: bindingId,
    expectedBlobId: blobId,
    execSql: runtime.execSql,
    resolveProjectionUserKey,
    targetSecretKey: encapsulationKeyPair.secretKey,
    writerProjection,
  });
  expect(new TextDecoder().decode(decryptedBytes)).toBe(
    "remote attachment bytes",
  );

  await expect(
    decryptDocumentAttachmentBlob({
      encryptedBytes: blob.encryptedBytes,
      expectedBindingId: "wrong-binding-id",
      expectedBlobId: blobId,
      execSql: runtime.execSql,
      resolveProjectionUserKey,
      targetSecretKey: encapsulationKeyPair.secretKey,
      writerProjection,
    }),
  ).rejects.toThrow("missing attachment target");

  const tamperedEncryptedBytes = JSON.parse(blob.encryptedBytes) as {
    contentKeyBundle: { targets: Record<string, unknown>[] };
  };
  await expect(
    decryptDocumentAttachmentBlob({
      encryptedBytes: JSON.stringify({
        ...tamperedEncryptedBytes,
        version: 2,
      }),
      expectedBindingId: bindingId,
      expectedBlobId: blobId,
      execSql: runtime.execSql,
      resolveProjectionUserKey,
      targetSecretKey: encapsulationKeyPair.secretKey,
      writerProjection,
    }),
  ).rejects.toThrow("Blob encrypted bytes version 2 is invalid; expected 1");

  const [firstTarget, ...remainingTargets] =
    tamperedEncryptedBytes.contentKeyBundle.targets;
  if (!firstTarget) {
    throw new Error("Expected uploaded blob content-key target.");
  }
  await expect(
    decryptDocumentAttachmentBlob({
      encryptedBytes: JSON.stringify({
        ...tamperedEncryptedBytes,
        contentKeyBundle: {
          ...tamperedEncryptedBytes.contentKeyBundle,
          targets: [
            {
              ...firstTarget,
              containerKeyEpochId: "tampered-container-key-epoch",
            },
            ...remainingTargets,
          ],
        },
      }),
      expectedBindingId: bindingId,
      expectedBlobId: blobId,
      execSql: runtime.execSql,
      resolveProjectionUserKey,
      targetSecretKey: encapsulationKeyPair.secretKey,
      writerProjection,
    }),
  ).rejects.toThrow("target hash is not canonical");
});

test("uploadDocumentAttachment rejects bind responses with tampered target material", async () => {
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const runtimePatch = await createDocumentRuntimePatch({
    encapsulationKeyPair,
    mapBindBlobAttachmentResponse: (response) => ({
      ...response,
      contentKeyBundle: {
        ...response.contentKeyBundle,
        targets: response.contentKeyBundle.targets.map((target, index) =>
          index === 0
            ? {
                ...target,
                wrappedKey: "tampered-wrapped-key",
              }
            : target,
        ),
      },
    }),
  });
  const author = {
    organizationId: runtimePatch.organizationId,
    signerDeviceId: "test-device-1",
    signerKeyFingerprint: runtimePatch.signingFingerprint,
    signerPrivateKey: runtimePatch.signingKeyPair.signingPrivateKey,
    signerUserId: runtimePatch.userId,
  };
  const resolveProjectionUserKey =
    createDocumentProjectionUserKeyResolver(runtimePatch);
  const created = await createRemoteDocument({
    apiClient: runtimePatch.apiClient,
    author,
    containerId: "root-container",
    documentId: "document-attachment-response-verification",
    resolveProjectionUserKey,
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: encapsulationKeyPair.secretKey,
  });
  if (!created) {
    throw new Error("Expected remote document fixture.");
  }

  await expect(
    uploadDocumentAttachment({
      apiClient: runtimePatch.apiClient,
      author,
      bytes: new TextEncoder().encode("tampered response bytes") as BlobBytes,
      documentId: created.documentId,
      expectedBindingId: null,
      resolveProjectionUserKey,
      signedAt: "2026-04-27T00:00:01.000Z",
      slotId: "tampered-response-slot",
      targetSecretKey: encapsulationKeyPair.secretKey,
    }),
  ).rejects.toThrow("content-key bundle mismatch");
});

test("uploadDocumentAttachment rejects document writer projections with bad signatures", async () => {
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const runtimePatch = await createDocumentRuntimePatch({
    encapsulationKeyPair,
    mapDocumentWriterProjectionResponse: (projection) => {
      const tamperedProjection = structuredClone(projection);
      const signedEvent = Reflect.get(
        tamperedProjection.documentManifest.event,
        "event",
      );
      if (!isPlainObject(signedEvent)) {
        throw new Error("Expected signed document event fixture.");
      }
      const signature = Reflect.get(signedEvent, "signature");
      if (typeof signature !== "string" || signature.length === 0) {
        throw new Error("Expected signed document signature fixture.");
      }
      Reflect.set(
        signedEvent,
        "signature",
        `${signature.slice(0, -1)}${signature.endsWith("A") ? "B" : "A"}`,
      );

      return tamperedProjection;
    },
  });
  const author = {
    organizationId: runtimePatch.organizationId,
    signerDeviceId: "test-device-1",
    signerKeyFingerprint: runtimePatch.signingFingerprint,
    signerPrivateKey: runtimePatch.signingKeyPair.signingPrivateKey,
    signerUserId: runtimePatch.userId,
  };
  const resolveProjectionUserKey =
    createDocumentProjectionUserKeyResolver(runtimePatch);
  const created = await createRemoteDocument({
    apiClient: runtimePatch.apiClient,
    author,
    containerId: "root-container",
    documentId: "document-attachment-bad-projection-signature",
    resolveProjectionUserKey,
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: encapsulationKeyPair.secretKey,
  });
  if (!created) {
    throw new Error("Expected remote document fixture.");
  }

  await expect(
    uploadDocumentAttachment({
      apiClient: runtimePatch.apiClient,
      author,
      bytes: new TextEncoder().encode("bad projection bytes") as BlobBytes,
      documentId: created.documentId,
      expectedBindingId: null,
      resolveProjectionUserKey,
      signedAt: "2026-04-27T00:00:01.000Z",
      slotId: "bad-projection-slot",
      targetSecretKey: encapsulationKeyPair.secretKey,
    }),
  ).rejects.toThrow("Document writer projection signature verification failed");
});

test("uploadDocumentAttachment uses a fresh IV for same-domain blob re-encryption", async () => {
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const runtimePatch = await createDocumentRuntimePatch({
    encapsulationKeyPair,
  });
  const author = {
    organizationId: runtimePatch.organizationId,
    signerDeviceId: "test-device-1",
    signerKeyFingerprint: runtimePatch.signingFingerprint,
    signerPrivateKey: runtimePatch.signingKeyPair.signingPrivateKey,
    signerUserId: runtimePatch.userId,
  };
  const resolveProjectionUserKey =
    createDocumentProjectionUserKeyResolver(runtimePatch);
  const created = await createRemoteDocument({
    apiClient: runtimePatch.apiClient,
    author,
    containerId: "root-container",
    documentId: "document-attachment-fresh-iv",
    resolveProjectionUserKey,
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: encapsulationKeyPair.secretKey,
  });
  if (!created) {
    throw new Error("Expected remote document fixture.");
  }

  const blobId = "550e8400-e29b-41d4-a716-446655440551";
  const bindingId = "550e8400-e29b-41d4-a716-446655440552";
  const contentKey = new Uint8Array(32).fill(7);
  const first = await uploadDocumentAttachment({
    apiClient: runtimePatch.apiClient,
    author,
    bindingId,
    blobId,
    bytes: new TextEncoder().encode("first blob payload") as BlobBytes,
    contentKey,
    documentId: created.documentId,
    expectedBindingId: null,
    resolveProjectionUserKey,
    signedAt: "2026-04-27T00:00:01.000Z",
    slotId: "fresh-iv-slot",
    targetSecretKey: encapsulationKeyPair.secretKey,
  });
  const second = await uploadDocumentAttachment({
    apiClient: runtimePatch.apiClient,
    author,
    bindingId,
    blobId,
    bytes: new TextEncoder().encode("second blob payload") as BlobBytes,
    contentKey,
    documentId: created.documentId,
    expectedBindingId: null,
    resolveProjectionUserKey,
    signedAt: "2026-04-27T00:00:02.000Z",
    slotId: "fresh-iv-slot",
    targetSecretKey: encapsulationKeyPair.secretKey,
  });
  if (!first || !second) {
    throw new Error("Expected uploaded blob fixtures.");
  }
  const firstRecord = JSON.parse(first.encryptedBytes) as ContentRecordFields;
  const secondRecord = JSON.parse(second.encryptedBytes) as ContentRecordFields;

  expect(firstRecord.contentRecordId).toBe(blobId);
  expect(secondRecord.contentRecordId).toBe(blobId);
  expect(firstRecord.nonceDomainHash).toBe(secondRecord.nonceDomainHash);
  expect(firstRecord.iv).not.toBe(bytesToBase64(new Uint8Array(12)));
  expect(secondRecord.iv).not.toBe(bytesToBase64(new Uint8Array(12)));
  expect(firstRecord.iv).not.toBe(secondRecord.iv);
  expect(firstRecord.ciphertext).not.toBe(secondRecord.ciphertext);
});

test("document store preserves a replacement queued during attachment upload", async () => {
  const persistence = createDocumentsPersistence();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const attachmentBinds: Array<{
    blobId: string;
    request: BlobAttachmentBindRequest;
  }> = [];
  let replacementQueued = false;
  let store: ReturnType<typeof createDocumentStore>;
  const runtime = await createSyncRuntime(
    encapsulationKeyPair,
    "shared-container",
    {
      attachmentBinds,
      onBindBlobAttachment: async () => {
        if (replacementQueued) {
          return;
        }

        const slotId = store.getSnapshot().attachments[0]?.slotId;
        if (!slotId) {
          throw new Error("Expected an attachment slot before replacement.");
        }

        replacementQueued = true;
        store.replaceAttachment(slotId, {
          bytes: new TextEncoder().encode("replacement bytes"),
          mimeType: "image/png",
          name: "replacement.png",
        });

        await waitForCondition(
          () =>
            persistence
              .getState()
              .pendingAttachments.some(
                (attachment) =>
                  attachment.slotId === slotId &&
                  attachment.name === "replacement.png",
              ),
          "Replacement attachment was not queued during upload.",
        );
      },
    },
  );
  store = createDocumentStore("attachment-replacement", runtime, persistence);
  store.updateRuntime(runtime);

  await waitForCondition(
    () => store.getSnapshot().ready,
    "Attachment replacement document store did not become ready.",
  );

  store.attachFiles([
    {
      bytes: new TextEncoder().encode("original bytes"),
      mimeType: "image/png",
      name: "original.png",
    },
  ]);

  await waitForCondition(
    () =>
      attachmentBinds.length === 2 &&
      persistence.getState().pendingAttachments.length === 0 &&
      persistence.getState().localAttachments[0]?.blobId !== null &&
      store.getSnapshot().attachments[0]?.name === "replacement.png",
    "Replacement attachment was not uploaded after the original upload completed.",
  );

  const localAttachment = persistence.getState().localAttachments[0];
  if (!localAttachment) {
    throw new Error("Expected a local attachment after replacement upload.");
  }

  const storedBytes = await runtime.blobStore.readBytes(
    localAttachment.storageKey,
  );
  expect(attachmentBinds).toHaveLength(2);
  expect(persistence.getState().pendingAttachments).toHaveLength(0);
  expect(store.getSnapshot().attachments[0]?.name).toBe("replacement.png");
  expect(new TextDecoder().decode(storedBytes ?? new Uint8Array())).toBe(
    "replacement bytes",
  );
});

test("document store keeps prior attachments when a second file is attached", async () => {
  const persistence = createDocumentsPersistence();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const runtime = await createSyncRuntime(
    encapsulationKeyPair,
    "shared-container",
  );
  const store = createDocumentStore(
    "attachment-sequence",
    runtime,
    persistence,
  );
  store.updateRuntime(runtime);

  await waitForCondition(
    () => store.getSnapshot().ready,
    "Sequential attachment document store did not become ready.",
  );

  store.attachFiles([
    {
      bytes: new TextEncoder().encode("first"),
      mimeType: "image/png",
      name: "first.png",
    },
  ]);

  await waitForCondition(
    () => store.getSnapshot().attachments.length === 1,
    "First attachment did not persist.",
  );

  store.attachFiles([
    {
      bytes: new TextEncoder().encode("second"),
      mimeType: "image/png",
      name: "second.png",
    },
  ]);

  await waitForCondition(
    () => store.getSnapshot().attachments.length === 2,
    "Second attachment did not persist.",
  );

  expect(
    store.getSnapshot().attachments.map((attachment) => attachment.name),
  ).toEqual(["first.png", "second.png"]);
});

test("document store reloads persisted attachment metadata from the note snapshot", async () => {
  const persistence = createDocumentsPersistence();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const runtime = await createSyncRuntime(encapsulationKeyPair);
  const firstStore = createDocumentStore(
    "attachment-reload",
    runtime,
    persistence,
  );
  firstStore.updateRuntime(runtime);

  await waitForCondition(
    () => firstStore.getSnapshot().ready,
    "First attachment document store did not become ready.",
  );

  firstStore.attachFiles([
    {
      bytes: new TextEncoder().encode("persisted attachment"),
      mimeType: "text/plain",
      name: "persisted.txt",
    },
  ]);

  await waitForCondition(
    () => firstStore.getSnapshot().attachments.length === 1,
    "Attachment metadata was not persisted to the first document store.",
  );

  const secondStore = createDocumentStore(
    "attachment-reload",
    createRuntime(),
    persistence,
  );
  secondStore.updateRuntime(createRuntime());

  await waitForCondition(
    () => secondStore.getSnapshot().ready,
    "Second attachment document store did not become ready.",
  );

  expect(secondStore.getSnapshot().attachments).toEqual([
    {
      byteLength: "persisted attachment".length,
      mimeType: "text/plain",
      name: "persisted.txt",
      slotId: firstStore.getSnapshot().attachments[0]?.slotId ?? "",
    },
  ]);
});

test("large note edits remain a single pending update row before sync", async () => {
  const runtime = await createSqlRuntime();

  try {
    const noteId = "large-note";
    const store = createDocumentStore(noteId, runtime);
    store.updateRuntime(runtime);

    await waitForCondition(
      () => store.getSnapshot().ready,
      "SQLite-backed document store did not become ready.",
    );

    const largeText = createLargeText(1024 * 1024);
    store.setText(largeText);

    await waitForCondition(async () => {
      const pendingRows = await runtime.execSql(
        `
 SELECT
 id,
 length(update_data) AS update_data_length
 FROM document_pending_updates
 WHERE app_kind = :appKind AND local_id = :localId
 `,
        {
          ":appKind": DOCUMENTS_APP_KIND,
          ":localId": noteId,
        },
      );

      const projectionRows = await runtime.execSql(
        `
 SELECT length(text) AS text_length
 FROM document_projection
 WHERE local_id = :localId
 `,
        {
          ":localId": noteId,
        },
      );
      const pendingRow = pendingRows[0];
      const projectionRow = projectionRows[0];

      return (
        pendingRows.length === 1 &&
        isPendingUpdateLengthRow(pendingRow) &&
        isProjectionLengthRow(projectionRow) &&
        Number(pendingRow.update_data_length ?? 0) > 256 * 1024 &&
        Number(projectionRow.text_length ?? 0) === largeText.length
      );
    }, "Large note edit was not persisted as a single pending update.");

    const pendingRows = await runtime.execSql(
      `
 SELECT
 id,
 length(update_data) AS update_data_length,
 partial_start_version_vector,
 partial_end_version_vector
 FROM document_pending_updates
 WHERE app_kind = :appKind AND local_id = :localId
 `,
      {
        ":appKind": DOCUMENTS_APP_KIND,
        ":localId": noteId,
      },
    );
    const pendingRow = pendingRows[0];

    expect(pendingRows).toHaveLength(1);
    if (!isPendingUpdateDetailRow(pendingRow)) {
      throw new Error("Expected a pending update detail row.");
    }

    expect(Number(pendingRow.update_data_length ?? 0)).toBeGreaterThan(
      256 * 1024,
    );
    expect(pendingRow.partial_start_version_vector).toBeString();
    expect(pendingRow.partial_end_version_vector).toBeString();
  } finally {
    runtime.close();
  }
});

test("document store does not restart attachment sync for commit-lsn-only probes", async () => {
  const persistence = createDocumentsPersistence();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const attachmentBinds: Array<{
    blobId: string;
    request: BlobAttachmentBindRequest;
  }> = [];
  const syncCalls: Array<{
    minLsn: string | null;
    outgoingUpdateCount: number;
  }> = [];
  const runtime = await createSyncRuntime(
    encapsulationKeyPair,
    "shared-container",
    {
      attachmentBinds,
      commitLsnForSyncCount: (syncCount) => `0/${syncCount}0`,
      syncCalls,
    },
  );
  const store = createDocumentStore("attachment-probe", runtime, persistence);
  store.updateRuntime(runtime);

  await waitForCondition(
    () => store.getSnapshot().ready,
    "Attachment probe document store did not become ready.",
  );

  store.setText("remote attachment note");

  await waitForCondition(
    () =>
      persistence.getState().document?.documentId !== null &&
      persistence.getState().pendingUpdates.length === 0 &&
      syncCalls.length === 1,
    "Attachment probe note was not synced before uploading.",
  );

  store.attachFiles([
    {
      bytes: new TextEncoder().encode("attachment probe bytes"),
      mimeType: "image/png",
      name: "probe.png",
    },
  ]);

  await waitForCondition(
    () =>
      attachmentBinds.length === 1 &&
      persistence.getState().pendingAttachments.length === 0,
    "Attachment upload was starved by commit-lsn-only sync probes.",
    2_000,
    10,
  );

  expect(syncCalls.some((call) => call.outgoingUpdateCount === 0)).toBe(true);
  expect(attachmentBinds).toHaveLength(1);
});

test("document store persists commitLsn and reuses it as minLsn on the next sync", async () => {
  const persistence = createDocumentsPersistence();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const syncDocumentCalls: Array<{
    minLsn: string | null;
    outgoingUpdateCount: number;
  }> = [];
  const runtime = await createSyncRuntime(
    encapsulationKeyPair,
    "root-container",
    {
      syncCalls: syncDocumentCalls,
    },
  );
  const store = createDocumentStore("default", runtime, persistence);
  store.updateRuntime(runtime);

  await waitForCondition(
    () => store.getSnapshot().ready,
    "Document sync store did not become ready.",
  );

  store.setText("hello");

  await waitForCondition(
    () =>
      syncDocumentCalls.length === 1 &&
      persistence.getState().pendingUpdates.length === 0 &&
      persistence.getState().document?.lastCommitLsn === "0/10",
    "Initial note document sync did not persist the returned commitLsn.",
  );

  store.setText("hello again");

  await waitForCondition(
    () =>
      syncDocumentCalls.length === 2 &&
      persistence.getState().pendingUpdates.length === 0 &&
      persistence.getState().document?.lastCommitLsn === "0/20",
    "Follow-up note sync did not reuse and refresh the persisted commitLsn.",
  );

  expect(syncDocumentCalls).toEqual([
    {
      minLsn: null,
      outgoingUpdateCount: 1,
    },
    {
      minLsn: "0/10",
      outgoingUpdateCount: 1,
    },
  ]);
});

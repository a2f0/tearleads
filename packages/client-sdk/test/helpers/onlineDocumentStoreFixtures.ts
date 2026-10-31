import type { DocumentSyncRequest } from "@tearleads/validators/request";
import type {
  BlobAttachmentSummary,
  DocumentSyncResponse,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import { createMemoryBlobStore } from "../../src/data/blobs/memoryBlobStore";
import { defaultDocumentProjectorRegistry } from "../../src/data/documents/documentKinds";
import { readWriteHeader } from "../../src/data/documents/shared/readers";
import { createDomainScope } from "../../src/data/shared/domainScope";
import type { DocumentsRuntime } from "../../src/stores/documents/types";
import { createDocumentsWorkflowRuntime } from "../../src/workflows/documents";
import type { BlobAttachmentBindFixture } from "./blobUploadFixtures";
import type { createMaterializedSyncFixture } from "./documentFixtures";
import type { DocumentCreateFixture } from "./documentResponseFixtures";

type MaterializedSyncFixture = Awaited<
  ReturnType<typeof createMaterializedSyncFixture>
>;

/** A server that accepts every outgoing update and echoes it back. */
export function createEchoDocumentSyncResponse(input: {
  readonly commitLsn: string;
  readonly pullPage?: DocumentSyncResponse["pullPage"];
  readonly request: DocumentSyncRequest;
  readonly storedDocument: DocumentCreateFixture;
}): DocumentSyncResponse {
  return {
    acceptedOutgoingUpdateIds: input.request.outgoingUpdates.map(
      (update) => update.id,
    ),
    commitLsn: input.commitLsn,
    commitLsnMode: "tracked",
    contentKeyBundle: input.storedDocument.contentKeyBundle,
    contentKeyBundles: [],
    documentId: input.storedDocument.id,
    documentKekTargets: input.storedDocument.documentKekTargets,
    pullPage: input.pullPage ?? { hasMore: false, nextCursor: null },
    updates: input.request.outgoingUpdates.map((update) => {
      const writeHeader = readWriteHeader(
        update.writeHeader,
        "Document sync write header",
      );
      return {
        accessEpoch: 1,
        authorizationTargets: input.storedDocument.contentKeyBundle.targets.map(
          (target) => ({
            containerId: target.containerId,
            containerKeyEpoch: target.containerKeyEpoch,
            containerKeyEpochId: target.containerKeyEpochId,
            containerManifestHash: target.containerManifestHash,
          }),
        ),
        authorFingerprint: writeHeader.writerKeyFingerprint,
        createdAt: "2026-04-27T00:00:00.000Z",
        documentId: input.storedDocument.id,
        encryptedData: update.encryptedData,
        id: update.id,
        partialEndVersionVector: update.partialEndVersionVector,
        partialStartVersionVector: update.partialStartVersionVector,
        plaintextHash: update.plaintextHash,
        writeHeader: update.writeHeader,
      };
    }),
  };
}

/** The writer projection a server returns for a document it just created. */
export function createStoredDocumentWriterProjection(
  fixture: MaterializedSyncFixture,
  storedDocument: DocumentCreateFixture,
): DocumentWriterProjectionResponse {
  return {
    policyEvidence: {
      organization: null,
      organizationPayloads: [],
      groups: [],
    },
    authorizingContainerPaths: [fixture.projection],
    contentKeyBundle: storedDocument.contentKeyBundle,
    documentContainerManifestHistory: [
      ...fixture.projection.path,
      ...fixture.projection.containerKeks.flatMap(
        (kek) => kek.containerManifestHistory,
      ),
    ],
    documentId: storedDocument.id,
    documentKekTargets: storedDocument.documentKekTargets,
    documentManifest: storedDocument.accessManifest,
    documentManifestContainerPaths: [[...fixture.projection.path]],
    documentManifestHistory: [],
  };
}

/** The listing entry a server reports for a binding it accepted. */
export function attachmentSummaryFromBind(
  response: BlobAttachmentBindFixture,
): BlobAttachmentSummary {
  return {
    bindingEvent: response.bindingEvent,
    bindingId: response.bindingId,
    blobId: response.blobId,
    blobKekTargets: response.blobKekTargets,
    contentKeyBundle: response.contentKeyBundle,
    documentManifestHash: response.documentManifestHash,
    previousBindingId: response.previousBindingId,
    slotId: response.slotId,
    writeAuthorization: response.writeAuthorization,
    writeHeader: response.writeHeader,
  };
}

/** An online, signed-in documents runtime for the fixture's author. */
export function createOnlineDocumentsRuntime(input: {
  readonly apiClient: DocumentsRuntime["apiClient"];
  readonly blobStore?: DocumentsRuntime["infra"]["blobStore"];
  readonly execSql: DocumentsRuntime["infra"]["execSql"];
  readonly fixture: MaterializedSyncFixture;
}): DocumentsRuntime {
  const { fixture } = input;
  return createDocumentsWorkflowRuntime({
    apiClient: input.apiClient,
    auth: {
      isAuthenticated: true,
      organizationId: fixture.author.organizationId,
      userId: fixture.author.signerUserId,
    },
    crypto: {
      encapsulationKeyPair: {
        publicKey: fixture.publicKey,
        secretKey: fixture.secretKey,
      },
      signingFingerprint: fixture.author.signerKeyFingerprint,
      signingKeyPair: {
        signingPrivateKey: fixture.author.signerPrivateKey,
        signingPublicKey: fixture.signingPublicKey,
      },
    },
    infra: {
      blobStore: input.blobStore ?? createMemoryBlobStore(),
      dbStatus: "ready",
      documentProjectors: defaultDocumentProjectorRegistry,
      execSql: input.execSql,
    },
    resolveTrustedUserIdentity: fixture.resolveProjectionUserKey,
    state: {
      containerId: fixture.projection.containerId,
      domainScope: createDomainScope(),
      events: [],
      online: true,
    },
    util: {
      log: () => {},
      reportSecurityIncident: async () => undefined,
    },
  });
}

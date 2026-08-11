import { expect, test } from "bun:test";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import type {
  BlobAttachmentBindRequest,
  DocumentSyncRequest,
} from "@tearleads/validators/request";
import type {
  BlobAttachmentSummary,
  DocumentCreateResponse,
  DocumentSyncResponse,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import {
  createBlobAttachmentBindResponse,
  createMultipartBlobStageFixture,
} from "../../../../test/helpers/blobUploadFixtures";
import {
  createMaterializedSyncFixture,
  createResponseFromRequest,
} from "../../../../test/helpers/documentFixtures";
import { waitFor } from "../../../../test/helpers/waitFor";
import { createMemoryBlobStore } from "../../../data/blobs/memoryBlobStore";
import { defaultDocumentProjectorRegistry } from "../../../data/documents/documentKinds";
import { readWriteHeader } from "../../../data/documents/shared/readers";
import { createDomainScope } from "../../../data/domainScope";
import { decryptDocumentAttachmentBlob } from "../../../workflows/blobs";
import {
  createDocumentsWorkflowRuntime,
  defaultDocumentsPersistence,
} from "../../../workflows/documents";
import { createDocumentStore } from "../documentStore";

function createDocumentSyncResponse(input: {
  readonly commitLsn: string;
  readonly request: DocumentSyncRequest;
  readonly storedDocument: DocumentCreateResponse;
}): DocumentSyncResponse {
  return {
    acceptedOutgoingUpdateIds: input.request.outgoingUpdates.map(
      (update) => update.id,
    ),
    commitLsn: input.commitLsn,
    contentKeyBundle: input.storedDocument.contentKeyBundle,
    contentKeyBundles: [input.storedDocument.contentKeyBundle],
    documentId: input.storedDocument.id,
    documentKekTargets: input.storedDocument.documentKekTargets,
    updates: input.request.outgoingUpdates.map((update) => {
      const writeHeader = readWriteHeader(
        update.writeHeader,
        "Document sync write header",
      );
      return {
        accessEpoch: 1,
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

test("document store uploads attachment bytes with signed bindings", async () => {
  const fixture = await createMaterializedSyncFixture();
  const { close, execSql } = await createTestExecSql(
    "document-store-attachment-upload",
  );
  const attachmentBinds: Array<{
    readonly blobId: string;
    readonly request: BlobAttachmentBindRequest;
  }> = [];
  const attachments: BlobAttachmentSummary[] = [];
  const blobs = new Map<
    string,
    {
      readonly byteLength: number;
      readonly encryptedBytes: Uint8Array<ArrayBuffer>;
      readonly sha256: string;
    }
  >();
  const syncCalls: Array<{
    readonly minLsn: string | null;
    readonly outgoingUpdateCount: number;
  }> = [];
  let syncCount = 0;
  let storedDocument: DocumentCreateResponse | null = null;
  let completedBlob: {
    readonly byteLength: number;
    readonly sha256: string;
  } | null = null;
  const { getAssembledBytes, ...multipartApi } =
    createMultipartBlobStageFixture();
  const writerProjection = (): DocumentWriterProjectionResponse | null =>
    storedDocument
      ? {
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
        }
      : null;

  const apiClient = createMockApiClient({
    ...multipartApi,
    async bindBlobAttachment(
      blobId: string,
      request: BlobAttachmentBindRequest,
    ) {
      const encryptedBytes = getAssembledBytes();
      if (
        !storedDocument ||
        !request.stagedBlob ||
        !encryptedBytes ||
        !completedBlob
      ) {
        return null;
      }
      const response = await createBlobAttachmentBindResponse({
        blobId,
        documentManifest: storedDocument.accessManifest,
        request,
      });
      attachmentBinds.push({ blobId, request });
      attachments.push({
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
      });
      blobs.set(blobId, {
        byteLength: completedBlob.byteLength,
        encryptedBytes,
        sha256: completedBlob.sha256,
      });
      return response;
    },
    completeMultipartBlobStage: async (stageId, request) => {
      const response = await multipartApi.completeMultipartBlobStage(
        stageId,
        request,
      );
      completedBlob = response;
      return response;
    },
    async createDocument(
      request: Parameters<typeof createResponseFromRequest>[0],
    ) {
      storedDocument = await createResponseFromRequest(request);
      return storedDocument;
    },
    getBlobBytes: async (blobId: string) => {
      const blob = blobs.get(blobId);
      if (!blob) {
        return null;
      }
      const midpoint = Math.ceil(blob.encryptedBytes.byteLength / 2);
      return {
        blobId,
        byteLength: blob.byteLength,
        encryptedBytes: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(blob.encryptedBytes.slice(0, midpoint));
            controller.enqueue(blob.encryptedBytes.slice(midpoint));
            controller.close();
          },
        }),
        sha256: blob.sha256,
      };
    },
    getContainerWriterProjection: async () => fixture.projection,
    getDocumentWriterProjection: async () => writerProjection(),
    listDocumentAttachments: async () => attachments,
    async syncDocument(_documentId: string, request: DocumentSyncRequest) {
      if (!storedDocument) {
        return null;
      }
      syncCalls.push({
        minLsn: request.minLsn ?? null,
        outgoingUpdateCount: request.outgoingUpdates.length,
      });
      syncCount += 1;
      return createDocumentSyncResponse({
        commitLsn: `0/${syncCount}0`,
        request,
        storedDocument,
      });
    },
  });
  const runtime = createDocumentsWorkflowRuntime({
    apiClient,
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
      blobStore: createMemoryBlobStore(),
      dbStatus: "ready",
      documentProjectors: defaultDocumentProjectorRegistry,
      execSql,
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
  const store = createDocumentStore(
    "attachment-upload",
    runtime,
    defaultDocumentsPersistence,
  );

  try {
    expect(await store.ensureInitialized()).toBe(true);
    store.attachFiles([
      {
        bytes: new TextEncoder().encode("remote attachment bytes"),
        mimeType: "image/png",
        name: "remote.png",
      },
    ]);
    await waitFor(
      () => attachmentBinds.length === 1 && !store.getSnapshot().syncing,
      "Pending attachment was not uploaded and synced.",
      2_000,
    );

    const bind = attachmentBinds[0];
    const attachment = attachments[0];
    const projection = writerProjection();
    const blob = attachment ? blobs.get(attachment.blobId) : null;
    if (!bind || !attachment || !projection || !blob) {
      throw new Error("Expected uploaded attachment fixtures.");
    }
    expect(bind.request.stagedBlob?.writeHeader).toBeDefined();
    expect(syncCalls.some((call) => call.outgoingUpdateCount === 1)).toBe(true);
    expect(store.getSnapshot().attachments).toHaveLength(1);

    const decryptedBytes = await decryptDocumentAttachmentBlob({
      binding: attachment,
      encryptedBytes: blob.encryptedBytes,
      expectedDocumentId: projection.documentId,
      expectedSlotId: attachment.slotId,
      execSql,
      resolveProjectionUserKey: fixture.resolveProjectionUserKey,
      targetSecretKey: fixture.secretKey,
      writerProjection: projection,
    });
    expect(new TextDecoder().decode(decryptedBytes)).toBe(
      "remote attachment bytes",
    );

    await expect(
      decryptDocumentAttachmentBlob({
        binding: { ...attachment, bindingId: "wrong-binding-id" },
        encryptedBytes: blob.encryptedBytes,
        expectedDocumentId: projection.documentId,
        expectedSlotId: attachment.slotId,
        execSql,
        resolveProjectionUserKey: fixture.resolveProjectionUserKey,
        targetSecretKey: fixture.secretKey,
        writerProjection: projection,
      }),
    ).rejects.toThrow(
      "attachment event binding id does not match expected binding id",
    );

    const invalidMagic = blob.encryptedBytes.slice();
    invalidMagic[0] = (invalidMagic[0] ?? 0) ^ 0xff;
    await expect(
      decryptDocumentAttachmentBlob({
        binding: attachment,
        encryptedBytes: invalidMagic,
        expectedDocumentId: projection.documentId,
        expectedSlotId: attachment.slotId,
        execSql,
        resolveProjectionUserKey: fixture.resolveProjectionUserKey,
        targetSecretKey: fixture.secretKey,
        writerProjection: projection,
      }),
    ).rejects.toThrow("Blob encrypted bytes magic is invalid");

    const [firstTarget, ...remainingTargets] =
      attachment.contentKeyBundle.targets;
    if (!firstTarget) {
      throw new Error("Expected uploaded blob content-key target.");
    }
    await expect(
      decryptDocumentAttachmentBlob({
        binding: {
          ...attachment,
          contentKeyBundle: {
            ...attachment.contentKeyBundle,
            targets: [
              {
                ...firstTarget,
                containerKeyEpochId: "tampered-container-key-epoch",
              },
              ...remainingTargets,
            ],
          },
        },
        encryptedBytes: blob.encryptedBytes,
        expectedDocumentId: projection.documentId,
        expectedSlotId: attachment.slotId,
        execSql,
        resolveProjectionUserKey: fixture.resolveProjectionUserKey,
        targetSecretKey: fixture.secretKey,
        writerProjection: projection,
      }),
    ).rejects.toThrow("target hash is not canonical");
  } finally {
    close();
  }
}, 10_000);

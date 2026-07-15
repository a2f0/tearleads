import { expect, test } from "bun:test";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import type {
  BlobAttachmentBindRequest,
  DocumentSyncRequest,
  StageBlobRequest,
} from "@tearleads/validators/request";
import type {
  BlobContentKeyBundleResponse,
  DocumentCreateResponse,
  DocumentSyncResponse,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import { createBlobAttachmentBindResponse } from "../../../../test/helpers/blobUploadFixtures";
import {
  createMaterializedSyncFixture,
  createResponseFromRequest,
} from "../../../../test/helpers/documentFixtures";
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

async function waitForCondition(
  condition: () => boolean,
  message: string,
): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(message);
}

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
  const attachments: Array<{
    readonly bindingId: string;
    readonly blobId: string;
    readonly contentKeyBundle: BlobContentKeyBundleResponse;
    readonly slotId: string;
  }> = [];
  const stagedBlobs = new Map<string, StageBlobRequest>();
  const blobs = new Map<
    string,
    { readonly encryptedBytes: string; readonly sha256: string }
  >();
  const syncCalls: Array<{
    readonly minLsn: string | null;
    readonly outgoingUpdateCount: number;
  }> = [];
  let stageCount = 0;
  let syncCount = 0;
  let storedDocument: DocumentCreateResponse | null = null;
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
    async bindBlobAttachment(
      blobId: string,
      request: BlobAttachmentBindRequest,
    ) {
      const stagedBlob = request.stagedBlob
        ? stagedBlobs.get(request.stagedBlob.stageId)
        : null;
      if (!storedDocument || (request.stagedBlob && !stagedBlob)) {
        return null;
      }
      const response = await createBlobAttachmentBindResponse({
        blobId,
        documentManifest: storedDocument.accessManifest,
        request,
      });
      attachmentBinds.push({ blobId, request });
      attachments.push({
        bindingId: response.bindingId,
        blobId: response.blobId,
        contentKeyBundle: response.contentKeyBundle,
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
      const encryptedBytes = new TextEncoder().encode(blob.encryptedBytes);
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
    getContainerWriterProjection: async () => fixture.projection,
    getDocumentWriterProjection: async () => writerProjection(),
    listDocumentAttachments: async () => attachments,
    async stageBlob(request: StageBlobRequest) {
      stageCount += 1;
      const stageId = `stage-${stageCount}`;
      stagedBlobs.set(stageId, request);
      return {
        expiresAt: "2026-04-27T00:05:00.000Z",
        stageId,
      };
    },
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
    await waitForCondition(
      () => attachmentBinds.length === 1 && !store.getSnapshot().syncing,
      "Pending attachment was not uploaded and synced.",
    );

    const bind = attachmentBinds[0];
    const attachment = attachments[0];
    const projection = writerProjection();
    const blob = attachment ? blobs.get(attachment.blobId) : null;
    if (!bind || !attachment || !projection || !blob) {
      throw new Error("Expected uploaded attachment fixtures.");
    }
    expect(bind.request.stagedBlob?.writeHeader).toBeDefined();
    expect(stagedBlobs).toHaveLength(0);
    expect(syncCalls.some((call) => call.outgoingUpdateCount === 1)).toBe(true);
    expect(store.getSnapshot().attachments).toHaveLength(1);

    const decryptedBytes = await decryptDocumentAttachmentBlob({
      contentKeyBundle: attachment.contentKeyBundle,
      encryptedBytes: blob.encryptedBytes,
      expectedBindingId: attachment.bindingId,
      expectedBlobId: attachment.blobId,
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
        contentKeyBundle: attachment.contentKeyBundle,
        encryptedBytes: blob.encryptedBytes,
        expectedBindingId: "wrong-binding-id",
        expectedBlobId: attachment.blobId,
        execSql,
        resolveProjectionUserKey: fixture.resolveProjectionUserKey,
        targetSecretKey: fixture.secretKey,
        writerProjection: projection,
      }),
    ).rejects.toThrow("missing attachment target");

    const encryptedRecord = JSON.parse(blob.encryptedBytes) as Record<
      string,
      unknown
    >;
    await expect(
      decryptDocumentAttachmentBlob({
        contentKeyBundle: attachment.contentKeyBundle,
        encryptedBytes: JSON.stringify({ ...encryptedRecord, version: 2 }),
        expectedBindingId: attachment.bindingId,
        expectedBlobId: attachment.blobId,
        execSql,
        resolveProjectionUserKey: fixture.resolveProjectionUserKey,
        targetSecretKey: fixture.secretKey,
        writerProjection: projection,
      }),
    ).rejects.toThrow("Blob encrypted bytes version 2 is invalid; expected 1");

    const [firstTarget, ...remainingTargets] =
      attachment.contentKeyBundle.targets;
    if (!firstTarget) {
      throw new Error("Expected uploaded blob content-key target.");
    }
    await expect(
      decryptDocumentAttachmentBlob({
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
        encryptedBytes: blob.encryptedBytes,
        expectedBindingId: attachment.bindingId,
        expectedBlobId: attachment.blobId,
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

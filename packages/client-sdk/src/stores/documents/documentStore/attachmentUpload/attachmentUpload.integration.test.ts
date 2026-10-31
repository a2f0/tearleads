import { expect, test } from "bun:test";
import { bytesToHex } from "@tearleads/crypto";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import type {
  BlobAttachmentBindRequest,
  DocumentSyncRequest,
} from "@tearleads/validators/request";
import type {
  BlobAttachmentSummary,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import {
  createBlobAttachmentBindResponse,
  createMultipartBlobStageFixture,
} from "../../../../../test/helpers/blobUploadFixtures";
import {
  createMaterializedSyncFixture,
  createResponseFromRequest,
  type DocumentCreateFixture,
} from "../../../../../test/helpers/documentFixtures";
import {
  attachmentSummaryFromBind,
  createEchoDocumentSyncResponse,
  createOnlineDocumentsRuntime,
  createStoredDocumentWriterProjection,
} from "../../../../../test/helpers/onlineDocumentStoreFixtures";
import { waitFor } from "../../../../../test/helpers/waitFor";
import { decryptDocumentAttachmentBlob } from "../../../../workflows/blobs";
import { defaultDocumentsPersistence } from "../../../../workflows/documents";
import { createDocumentStore } from "../index";

test("document store uploads attachment bytes with signed bindings", async () => {
  const fixture = await createMaterializedSyncFixture();
  const { close, execSql } = await createTestExecSql(
    "document-store-attachment-upload",
  );
  const attachmentBinds: Array<{
    readonly blobId: string;
    readonly request: BlobAttachmentBindRequest;
  }> = [];
  const attachmentBindSyncCounts: number[] = [];
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
  let injectedSettlementRace = false;
  let storedDocument: DocumentCreateFixture | null = null;
  const { getAssembledBytes, ...multipartApi } =
    createMultipartBlobStageFixture();
  const writerProjection = (): DocumentWriterProjectionResponse | null =>
    storedDocument
      ? createStoredDocumentWriterProjection(fixture, storedDocument)
      : null;

  const apiClient = createMockApiClient({
    ...multipartApi,
    async bindBlobAttachment(
      blobId: string,
      request: BlobAttachmentBindRequest,
    ) {
      // Binding completes the stage: the assembled parts become the blob.
      const encryptedBytes = getAssembledBytes();
      if (!storedDocument || !request.stagedBlob || !encryptedBytes) {
        return null;
      }
      const response = await createBlobAttachmentBindResponse({
        blobId,
        documentManifest: storedDocument.accessManifest,
        request,
      });
      attachmentBindSyncCounts.push(syncCount);
      attachmentBinds.push({ blobId, request });
      attachments.push(attachmentSummaryFromBind(response));
      blobs.set(blobId, {
        byteLength: encryptedBytes.byteLength,
        encryptedBytes,
        sha256: bytesToHex(
          new Uint8Array(await crypto.subtle.digest("SHA-256", encryptedBytes)),
        ),
      });
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
      const hasMore = syncCount <= 2;
      if (syncCount === 3 && !injectedSettlementRace) {
        const durableRecord = await defaultDocumentsPersistence.loadDocument(
          execSql,
          "attachment-upload",
        );
        if (!durableRecord) {
          throw new Error("Expected durable attachment document");
        }
        injectedSettlementRace = true;
        await defaultDocumentsPersistence.saveDocument(execSql, {
          ...durableRecord,
          lastCommitLsn: "0/35",
          pullContinuation: {
            commitLsn: "0/35",
            commitLsnMode: "tracked",
            cursor: "other-pane-attachment-page",
          },
        });
      }
      return createEchoDocumentSyncResponse({
        commitLsn: `0/${syncCount}0`,
        pullPage: {
          hasMore,
          nextCursor: hasMore ? `attachment-page-${syncCount + 1}` : null,
        },
        request,
        storedDocument,
      });
    },
  });
  const runtime = createOnlineDocumentsRuntime({ apiClient, execSql, fixture });
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
    expect(attachmentBindSyncCounts).toEqual([4]);
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

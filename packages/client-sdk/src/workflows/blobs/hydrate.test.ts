import { expect, test } from "bun:test";
import {
  decryptDocumentAttachmentBlob,
  hydrateDocumentAttachmentBlobs,
  uploadDocumentAttachment,
} from "@tearleads/client-sdk";
import {
  type AccessEvent,
  computeBlobAccessManifestHash,
  computeWriteHeaderHash,
  type WriteHeader,
} from "@tearleads/crypto";
import { createMaterializedSyncFixture } from "../../../test/helpers/documentFixtures";
import type { BlobBytes } from "../../data/blobContracts";
import type { DocumentAttachment } from "../../data/documents/documentContent";

const TEXT_ENCODER = new TextEncoder();

function createBlobBytesResponse(input: {
  readonly blobId: string;
  readonly byteLength?: number | undefined;
  readonly encryptedBytes: string;
  readonly onChunk?: (() => void) | undefined;
  readonly sha256: string;
}) {
  const encryptedBytes = TEXT_ENCODER.encode(input.encryptedBytes);
  const midpoint = Math.ceil(encryptedBytes.byteLength / 2);
  const chunks = [
    encryptedBytes.slice(0, midpoint),
    encryptedBytes.slice(midpoint),
  ].filter((chunk) => chunk.byteLength > 0);
  let nextChunkIndex = 0;

  return {
    blobId: input.blobId,
    byteLength: input.byteLength ?? encryptedBytes.byteLength,
    encryptedBytes: new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks[nextChunkIndex];
        if (!chunk) {
          controller.close();
          return;
        }

        nextChunkIndex += 1;
        input.onChunk?.();
        controller.enqueue(chunk);
      },
    }),
    sha256: input.sha256,
  };
}

async function createUploadedAttachmentFixture() {
  const { author, resolveProjectionUserKey, secretKey, writerProjection } =
    await createMaterializedSyncFixture();
  const blobId = "550e8400-e29b-41d4-a716-446655440560";
  const bindingId = "550e8400-e29b-41d4-a716-446655440561";
  const slotId = "preview";
  const bytes = new TextEncoder().encode(
    "remote attachment payload",
  ) as BlobBytes;
  const stageCapture: {
    stagedBlob?: {
      encryptedBytes: string;
      sha256: string;
      byteLength: number;
    };
  } = {};

  const uploaded = await uploadDocumentAttachment({
    apiClient: {
      bindBlobAttachment: async (_blobId, request) => {
        const targets = request.contentKeyBundle.targets;
        const linkedContainerManifestHashes = [
          ...new Set(targets.map((target) => target.containerManifestHash)),
        ].sort();
        const linkedContainerKeyEpochIds = [
          ...new Set(targets.map((target) => target.containerKeyEpochId)),
        ].sort();
        const blobAccessManifestHash = await computeBlobAccessManifestHash({
          version: 1,
          blobId,
          organizationId: author.organizationId,
          activeBindingIds: [bindingId],
          documentManifestHashes: [
            writerProjection.documentManifest.manifestHash,
          ],
          linkedContainerManifestHashes,
          linkedContainerKeyEpochIds,
          blobKeyTargetHash: request.contentKeyBundle.targetHash,
        });
        if (!request.stagedBlob) {
          throw new Error("Expected staged blob request");
        }

        return {
          bindingId,
          blobId,
          documentId: writerProjection.documentId,
          slotId,
          contentKeyBundle: {
            blobId,
            ...request.contentKeyBundle,
          },
          blobKekTargets: {
            blobId,
            organizationId: author.organizationId,
            activeBindingIds: [bindingId],
            documentManifestHashes: [
              writerProjection.documentManifest.manifestHash,
            ],
            linkedContainerManifestHashes,
            linkedContainerKeyEpochIds,
            targets: targets.map((target) => ({ ...target })),
            blobKeyTargetHash: request.contentKeyBundle.targetHash,
            blobAccessManifestHash,
          },
          writeHeaderHash: await computeWriteHeaderHash(
            request.stagedBlob.writeHeader as unknown as WriteHeader,
          ),
        };
      },
      getDocumentWriterProjection: async () => writerProjection,
      stageBlob: async (input) => {
        stageCapture.stagedBlob = input;
        return {
          stageId: "stage-hydrate-blob",
          expiresAt: "2026-04-27T01:00:00.000Z",
        };
      },
    },
    author,
    bindingId,
    blobId,
    bytes,
    documentId: writerProjection.documentId,
    expectedBindingId: null,
    resolveProjectionUserKey,
    signedAt: "2026-04-27T00:00:00.000Z",
    slotId,
    targetSecretKey: secretKey,
  });
  const { stagedBlob } = stageCapture;
  if (!uploaded || !stagedBlob) {
    throw new Error("Expected uploaded attachment fixture");
  }

  const attachment: DocumentAttachment = {
    byteLength: bytes.byteLength,
    mimeType: "text/plain",
    name: "payload.txt",
    slotId,
  };

  return {
    attachment,
    blobId,
    bindingId,
    bytes,
    resolveProjectionUserKey,
    secretKey,
    stagedBlob,
    uploaded,
    writerProjection,
  };
}

type UploadedAttachmentFixture = Awaited<
  ReturnType<typeof createUploadedAttachmentFixture>
>;
type HydrationApi = Parameters<
  typeof hydrateDocumentAttachmentBlobs
>[0]["apiClient"];

function createFixtureBinding(fixture: UploadedAttachmentFixture) {
  return {
    bindingId: fixture.bindingId,
    blobId: fixture.blobId,
    contentKeyBundle: fixture.uploaded.response.contentKeyBundle,
    slotId: fixture.attachment.slotId,
  };
}

function createSingleAttachmentHydrationApi(
  fixture: UploadedAttachmentFixture,
  getBlobBytes: HydrationApi["getBlobBytes"],
): HydrationApi {
  return {
    getBlobBytes,
    getDocumentWriterProjection: async () => fixture.writerProjection,
    listDocumentAttachments: async () => [createFixtureBinding(fixture)],
  };
}

test("hydrateDocumentAttachmentBlobs downloads and decrypts remote attachment bytes", async () => {
  const fixture = await createUploadedAttachmentFixture();
  let streamedChunks = 0;

  const hydratedBlobs = await hydrateDocumentAttachmentBlobs({
    apiClient: createSingleAttachmentHydrationApi(fixture, async (blobId) =>
      createBlobBytesResponse({
        blobId,
        encryptedBytes: fixture.stagedBlob.encryptedBytes,
        onChunk: () => {
          streamedChunks += 1;
        },
        sha256: fixture.stagedBlob.sha256,
      }),
    ),
    attachments: [fixture.attachment],
    documentId: fixture.writerProjection.documentId,
    resolveProjectionUserKey: fixture.resolveProjectionUserKey,
    targetSecretKey: fixture.secretKey,
  });
  const [hydratedBlob] = hydratedBlobs ?? [];

  expect(hydratedBlob?.attachment).toEqual(fixture.attachment);
  expect(hydratedBlob?.binding).toEqual({
    bindingId: fixture.bindingId,
    blobId: fixture.blobId,
    contentKeyBundle: fixture.uploaded.response.contentKeyBundle,
    slotId: fixture.attachment.slotId,
  });
  expect(hydratedBlob?.storageKey).toBe(`blob-${fixture.blobId}`);
  expect(Array.from(hydratedBlob?.bytes ?? [])).toEqual(
    Array.from(fixture.bytes),
  );
  expect(streamedChunks).toBeGreaterThan(1);
});

test("hydrateDocumentAttachmentBlobs skips locally current attachment bytes", async () => {
  const fixture = await createUploadedAttachmentFixture();
  let blobByteReads = 0;

  const hydratedBlobs = await hydrateDocumentAttachmentBlobs({
    apiClient: createSingleAttachmentHydrationApi(fixture, async () => {
      blobByteReads += 1;
      return null;
    }),
    attachments: [fixture.attachment],
    documentId: fixture.writerProjection.documentId,
    localBlobIdBySlotId: {
      [fixture.attachment.slotId]: fixture.blobId,
    },
    localStorageKeyBySlotId: {
      [fixture.attachment.slotId]: `blob-${fixture.blobId}`,
    },
    resolveProjectionUserKey: fixture.resolveProjectionUserKey,
    targetSecretKey: fixture.secretKey,
  });

  expect(hydratedBlobs).toEqual([]);
  expect(blobByteReads).toBe(0);
});

test("hydrateDocumentAttachmentBlobs preserves pending local attachment bytes", async () => {
  const fixture = await createUploadedAttachmentFixture();
  let blobByteReads = 0;

  const hydratedBlobs = await hydrateDocumentAttachmentBlobs({
    apiClient: createSingleAttachmentHydrationApi(fixture, async () => {
      blobByteReads += 1;
      return null;
    }),
    attachments: [fixture.attachment],
    documentId: fixture.writerProjection.documentId,
    localBlobIdBySlotId: {
      [fixture.attachment.slotId]: null,
    },
    localStorageKeyBySlotId: {
      [fixture.attachment.slotId]: "local-pending-preview",
    },
    resolveProjectionUserKey: fixture.resolveProjectionUserKey,
    targetSecretKey: fixture.secretKey,
  });

  expect(hydratedBlobs).toEqual([]);
  expect(blobByteReads).toBe(0);
});

test("hydrateDocumentAttachmentBlobs refreshes unknown same-slot blob bytes", async () => {
  const fixture = await createUploadedAttachmentFixture();
  let streamedChunks = 0;

  const hydratedBlobs = await hydrateDocumentAttachmentBlobs({
    apiClient: createSingleAttachmentHydrationApi(fixture, async (blobId) =>
      createBlobBytesResponse({
        blobId,
        encryptedBytes: fixture.stagedBlob.encryptedBytes,
        onChunk: () => {
          streamedChunks += 1;
        },
        sha256: fixture.stagedBlob.sha256,
      }),
    ),
    attachments: [fixture.attachment],
    documentId: fixture.writerProjection.documentId,
    localStorageKeyBySlotId: {
      [fixture.attachment.slotId]: "blob-unknown",
    },
    resolveProjectionUserKey: fixture.resolveProjectionUserKey,
    targetSecretKey: fixture.secretKey,
  });
  const [hydratedBlob] = hydratedBlobs ?? [];

  expect(hydratedBlob?.binding.blobId).toBe(fixture.blobId);
  expect(hydratedBlob?.storageKey).toBe(`blob-${fixture.blobId}`);
  expect(streamedChunks).toBeGreaterThan(1);
});

test("hydrateDocumentAttachmentBlobs refreshes stale same-slot blob bytes", async () => {
  const fixture = await createUploadedAttachmentFixture();
  let streamedChunks = 0;

  const hydratedBlobs = await hydrateDocumentAttachmentBlobs({
    apiClient: createSingleAttachmentHydrationApi(fixture, async (blobId) =>
      createBlobBytesResponse({
        blobId,
        encryptedBytes: fixture.stagedBlob.encryptedBytes,
        onChunk: () => {
          streamedChunks += 1;
        },
        sha256: fixture.stagedBlob.sha256,
      }),
    ),
    attachments: [fixture.attachment],
    documentId: fixture.writerProjection.documentId,
    localBlobIdBySlotId: {
      [fixture.attachment.slotId]: "stale-blob-id",
    },
    localStorageKeyBySlotId: {
      [fixture.attachment.slotId]: "blob-stale-blob-id",
    },
    resolveProjectionUserKey: fixture.resolveProjectionUserKey,
    targetSecretKey: fixture.secretKey,
  });
  const [hydratedBlob] = hydratedBlobs ?? [];

  expect(hydratedBlob?.binding.blobId).toBe(fixture.blobId);
  expect(hydratedBlob?.storageKey).toBe(`blob-${fixture.blobId}`);
  expect(Array.from(hydratedBlob?.bytes ?? [])).toEqual(
    Array.from(fixture.bytes),
  );
  expect(streamedChunks).toBeGreaterThan(1);
});

test("decryptDocumentAttachmentBlob rejects bad writer projection signatures", async () => {
  const fixture = await createUploadedAttachmentFixture();
  const tamperedProjection = structuredClone(fixture.writerProjection);
  const signedEvent = tamperedProjection.documentManifest.event
    .event as unknown as AccessEvent;
  const signature = signedEvent.signature;
  if (typeof signature !== "string" || signature.length === 0) {
    throw new Error("Expected signed document event fixture");
  }
  signedEvent.signature = `${signature.slice(0, -1)}${
    signature.endsWith("A") ? "B" : "A"
  }`;

  await expect(
    decryptDocumentAttachmentBlob({
      contentKeyBundle: fixture.uploaded.response.contentKeyBundle,
      encryptedBytes: fixture.stagedBlob.encryptedBytes,
      expectedBindingId: fixture.bindingId,
      expectedBlobId: fixture.blobId,
      resolveProjectionUserKey: fixture.resolveProjectionUserKey,
      targetSecretKey: fixture.secretKey,
      writerProjection: tamperedProjection,
    }),
  ).rejects.toThrow("Document writer projection signature verification failed");
});

test("hydrateDocumentAttachmentBlobs reuses one writer projection for matched attachments", async () => {
  const fixture = await createUploadedAttachmentFixture();
  const secondAttachment: DocumentAttachment = {
    ...fixture.attachment,
    slotId: "preview-copy",
  };
  let blobByteReads = 0;
  let writerProjectionCalls = 0;

  const hydratedBlobs = await hydrateDocumentAttachmentBlobs({
    apiClient: {
      getBlobBytes: async (blobId) => {
        blobByteReads += 1;
        return createBlobBytesResponse({
          blobId,
          encryptedBytes: fixture.stagedBlob.encryptedBytes,
          sha256: fixture.stagedBlob.sha256,
        });
      },
      getDocumentWriterProjection: async () => {
        writerProjectionCalls += 1;
        return fixture.writerProjection;
      },
      listDocumentAttachments: async () => [
        {
          bindingId: fixture.bindingId,
          blobId: fixture.blobId,
          contentKeyBundle: fixture.uploaded.response.contentKeyBundle,
          slotId: fixture.attachment.slotId,
        },
        {
          bindingId: fixture.bindingId,
          blobId: fixture.blobId,
          contentKeyBundle: fixture.uploaded.response.contentKeyBundle,
          slotId: secondAttachment.slotId,
        },
      ],
    },
    attachments: [fixture.attachment, secondAttachment],
    documentId: fixture.writerProjection.documentId,
    resolveProjectionUserKey: fixture.resolveProjectionUserKey,
    targetSecretKey: fixture.secretKey,
  });

  expect(blobByteReads).toBe(1);
  expect(writerProjectionCalls).toBe(1);
  expect(hydratedBlobs?.map((blob) => blob.attachment.slotId)).toEqual([
    fixture.attachment.slotId,
    secondAttachment.slotId,
  ]);
});

test("hydrateDocumentAttachmentBlobs skips blobs with a digest mismatch", async () => {
  const fixture = await createUploadedAttachmentFixture();
  const logs: string[] = [];

  const hydratedBlobs = await hydrateDocumentAttachmentBlobs({
    apiClient: createSingleAttachmentHydrationApi(fixture, async (blobId) =>
      createBlobBytesResponse({
        blobId,
        encryptedBytes: fixture.stagedBlob.encryptedBytes,
        sha256: "bad-sha256",
      }),
    ),
    attachments: [fixture.attachment],
    documentId: fixture.writerProjection.documentId,
    log: (message) => logs.push(message),
    resolveProjectionUserKey: fixture.resolveProjectionUserKey,
    targetSecretKey: fixture.secretKey,
  });

  expect(hydratedBlobs).toEqual([]);
  expect(logs).toEqual([
    `Documents: blob ${fixture.blobId} sha256 mismatch during hydration.`,
  ]);
});

test("hydrateDocumentAttachmentBlobs skips blobs with a byte length mismatch", async () => {
  const fixture = await createUploadedAttachmentFixture();
  const logs: string[] = [];

  const hydratedBlobs = await hydrateDocumentAttachmentBlobs({
    apiClient: createSingleAttachmentHydrationApi(fixture, async (blobId) =>
      createBlobBytesResponse({
        blobId,
        byteLength: fixture.stagedBlob.byteLength + 1,
        encryptedBytes: fixture.stagedBlob.encryptedBytes,
        sha256: fixture.stagedBlob.sha256,
      }),
    ),
    attachments: [fixture.attachment],
    documentId: fixture.writerProjection.documentId,
    log: (message) => logs.push(message),
    resolveProjectionUserKey: fixture.resolveProjectionUserKey,
    targetSecretKey: fixture.secretKey,
  });

  expect(hydratedBlobs).toEqual([]);
  expect(logs).toEqual([
    `Documents: blob ${fixture.blobId} byte length mismatch during hydration.`,
  ]);
});

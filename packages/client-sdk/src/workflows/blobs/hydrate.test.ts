import { afterEach, expect, test } from "bun:test";
import type { AccessEvent } from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  createBlobAttachmentBindResponse,
  createMultipartBlobStageFixture,
} from "../../../test/helpers/blobUploadFixtures";
import { createMaterializedSyncFixture } from "../../../test/helpers/documentFixtures";
import type { BlobBytes } from "../../data/blobContracts";
import type { DocumentAttachment } from "../../data/documents/documentContent";
import { decryptDocumentAttachmentBlob } from "./decrypt";
import { hydrateDocumentAttachmentBlobs } from "./hydrate";
import { uploadDocumentAttachment } from "./upload";

const closeTestDatabases: Array<() => void> = [];

afterEach(() => {
  closeTestDatabases.splice(0).forEach((close) => {
    close();
  });
});

function createBlobBytesResponse(input: {
  readonly blobId: string;
  readonly byteLength?: number | undefined;
  readonly encryptedBytes: Uint8Array<ArrayBuffer>;
  readonly onChunk?: (() => void) | undefined;
  readonly sha256: string;
}) {
  const encryptedBytes = input.encryptedBytes.slice();
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
  const { close, execSql } = await createTestExecSql("attachment-hydration");
  closeTestDatabases.push(close);
  const { getAssembledBytes, ...multipartApi } =
    createMultipartBlobStageFixture();

  const uploaded = await uploadDocumentAttachment({
    apiClient: {
      ...multipartApi,
      bindBlobAttachment: async (_blobId, request) => {
        return createBlobAttachmentBindResponse({
          blobId,
          documentManifest: writerProjection.documentManifest,
          request,
        });
      },
      getDocumentWriterProjection: async () => writerProjection,
    },
    author,
    bindingId,
    blobId,
    bytes,
    documentId: writerProjection.documentId,
    execSql,
    expectedBindingId: null,
    resolveProjectionUserKey,
    signedAt: "2026-04-27T00:00:00.000Z",
    slotId,
    targetSecretKey: secretKey,
  });
  const encryptedBytes = getAssembledBytes();
  if (!uploaded || !encryptedBytes) {
    throw new Error("Expected uploaded attachment fixture");
  }
  const stagedBlob = {
    byteLength: uploaded.byteLength,
    encryptedBytes,
    sha256: uploaded.sha256,
  };

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
    execSql,
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
    execSql: fixture.execSql,
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
    execSql: fixture.execSql,
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
    execSql: fixture.execSql,
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
    execSql: fixture.execSql,
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
    execSql: fixture.execSql,
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
      execSql: fixture.execSql,
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
    execSql: fixture.execSql,
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
    execSql: fixture.execSql,
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
    execSql: fixture.execSql,
    log: (message) => logs.push(message),
    resolveProjectionUserKey: fixture.resolveProjectionUserKey,
    targetSecretKey: fixture.secretKey,
  });

  expect(hydratedBlobs).toEqual([]);
  expect(logs).toEqual([
    `Documents: blob ${fixture.blobId} byte length mismatch during hydration.`,
  ]);
});

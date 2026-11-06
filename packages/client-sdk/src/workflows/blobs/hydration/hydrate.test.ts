import { expect, test } from "bun:test";
import {
  createBlobBytesResponse,
  createFixtureBinding,
  createSingleAttachmentHydrationApi,
  createUploadedAttachmentFixture,
  stagedBindingSummary,
} from "../../../../test/helpers/blobHydration";
import {
  createBlobAttachmentBindResponse,
  createMultipartBlobStageFixture,
} from "../../../../test/helpers/blobUploadFixtures";
import type { BlobBytes } from "../../../data/blobs/blobContracts";
import { attachmentContentSha256 } from "../../../data/documents/attachmentContentIdentity";
import type { DocumentAttachment } from "../../../data/documents/documentContent";
import { uploadDocumentAttachment } from "../upload";
import { hydrateDocumentAttachmentBlobs } from "./hydrate";

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
  expect(hydratedBlob?.binding).toEqual(createFixtureBinding(fixture));
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

test("hydrateDocumentAttachmentBlobs isolates a binding reused for another slot", async () => {
  const fixture = await createUploadedAttachmentFixture();
  const secondAttachment: DocumentAttachment = {
    ...fixture.attachment,
    slotId: "preview-copy",
  };
  let blobByteReads = 0;
  let writerProjectionCalls = 0;

  const incidents: unknown[] = [];
  const hydrated = await hydrateDocumentAttachmentBlobs({
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
        createFixtureBinding(fixture),
        {
          ...createFixtureBinding(fixture),
          slotId: secondAttachment.slotId,
        },
      ],
    },
    attachments: [fixture.attachment, secondAttachment],
    documentId: fixture.writerProjection.documentId,
    execSql: fixture.execSql,
    resolveProjectionUserKey: fixture.resolveProjectionUserKey,
    reportSecurityIncident: async (error) => {
      incidents.push(error);
    },
    targetSecretKey: fixture.secretKey,
  });
  expect(hydrated?.map((item) => item.attachment.slotId)).toEqual([
    fixture.attachment.slotId,
  ]);
  expect(Array.from(hydrated?.[0]?.bytes ?? [])).toEqual(
    Array.from(fixture.bytes),
  );
  expect(incidents).toHaveLength(1);
  expect(incidents[0]).toMatchObject({ code: "object_mismatch" });

  expect(blobByteReads).toBe(1);
  expect(writerProjectionCalls).toBe(1);
});

test("hydrateDocumentAttachmentBlobs reuses one projection for distinct attachments", async () => {
  const fixture = await createUploadedAttachmentFixture();
  const blobId = "550e8400-e29b-41d4-a716-446655440564";
  const bindingId = "550e8400-e29b-41d4-a716-446655440565";
  const slotId = "preview-distinct";
  const bytes = new TextEncoder().encode("second attachment") as BlobBytes;
  const { getAssembledBytes, ...multipart } = createMultipartBlobStageFixture();
  const uploaded = await uploadDocumentAttachment({
    apiClient: {
      ...multipart,
      bindBlobAttachment: async (_blobId, request) =>
        createBlobAttachmentBindResponse({
          blobId,
          documentManifest: fixture.writerProjection.documentManifest,
          request,
        }),
      getDocumentWriterProjection: async () => fixture.writerProjection,
    },
    author: fixture.author,
    bindingId,
    blobId,
    bytes,
    documentId: fixture.writerProjection.documentId,
    execSql: fixture.execSql,
    expectedBindingId: null,
    resolveProjectionUserKey: fixture.resolveProjectionUserKey,
    signedAt: "2026-04-27T00:02:00.000Z",
    slotId,
    targetSecretKey: fixture.secretKey,
  });
  const encryptedBytes = getAssembledBytes();
  if (!uploaded || !encryptedBytes) {
    throw new Error("Expected second attachment fixture");
  }
  const secondAttachment: DocumentAttachment = {
    contentSha256: await attachmentContentSha256(bytes),
    byteLength: bytes.byteLength,
    mimeType: "text/plain",
    name: "second.txt",
    slotId,
  };
  let writerProjectionCalls = 0;
  const hydrated = await hydrateDocumentAttachmentBlobs({
    apiClient: {
      getBlobBytes: async (requestedBlobId) =>
        createBlobBytesResponse(
          requestedBlobId === blobId
            ? { blobId, encryptedBytes, sha256: uploaded.sha256 }
            : {
                blobId: fixture.blobId,
                encryptedBytes: fixture.stagedBlob.encryptedBytes,
                sha256: fixture.stagedBlob.sha256,
              },
        ),
      getDocumentWriterProjection: async () => {
        writerProjectionCalls += 1;
        return fixture.writerProjection;
      },
      listDocumentAttachments: async () => [
        createFixtureBinding(fixture),
        stagedBindingSummary(uploaded),
      ],
    },
    attachments: [fixture.attachment, secondAttachment],
    documentId: fixture.writerProjection.documentId,
    execSql: fixture.execSql,
    resolveProjectionUserKey: fixture.resolveProjectionUserKey,
    targetSecretKey: fixture.secretKey,
  });

  expect(hydrated?.map((item) => item.attachment.slotId)).toEqual([
    fixture.attachment.slotId,
    slotId,
  ]);
  expect(writerProjectionCalls).toBe(1);
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

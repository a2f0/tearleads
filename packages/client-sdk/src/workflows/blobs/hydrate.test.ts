import { afterEach, expect, test } from "bun:test";
import {
  type AccessEvent,
  computeBlobAccessManifestHash,
  computeBlobContentKeyTargetHash,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  signWriteHeader,
  toFingerprint,
} from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  createBlobAttachmentBindResponse,
  createMultipartBlobStageFixture,
} from "../../../test/helpers/blobUploadFixtures";
import { createMaterializedSyncFixture } from "../../../test/helpers/documentFixtures";
import { createTestTrustedUserIdentity } from "../../../test/helpers/trustedUserIdentity";
import type { BlobBytes } from "../../data/blobContracts";
import type { DocumentAttachment } from "../../data/documents/documentContent";
import { readWriteHeader } from "../../data/documents/shared/readers";
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
  const contentKey = crypto.getRandomValues(new Uint8Array(32));
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
    contentKey,
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
    author,
    blobId,
    bindingId,
    bytes,
    contentKey,
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
    bindingEvent: fixture.uploaded.response.bindingEvent,
    bindingId: fixture.bindingId,
    blobId: fixture.blobId,
    blobKekTargets: fixture.uploaded.response.blobKekTargets,
    contentKeyBundle: fixture.uploaded.response.contentKeyBundle,
    documentManifestHash: fixture.uploaded.response.documentManifestHash,
    previousBindingId: fixture.uploaded.response.previousBindingId,
    slotId: fixture.attachment.slotId,
    writeAuthorization: fixture.uploaded.response.writeAuthorization,
    writeHeader: fixture.uploaded.response.writeHeader,
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
  expect(hydratedBlob?.binding).toEqual(createFixtureBinding(fixture));
  expect(hydratedBlob?.storageKey).toBe(`blob-${fixture.blobId}`);
  expect(Array.from(hydratedBlob?.bytes ?? [])).toEqual(
    Array.from(fixture.bytes),
  );
  expect(streamedChunks).toBeGreaterThan(1);
});

test("decryptDocumentAttachmentBlob accepts the signed write-time authorization after blob targets advance", async () => {
  const fixture = await createUploadedAttachmentFixture();
  const binding = createFixtureBinding(fixture);
  const originalEnvelope = binding.contentKeyBundle.targets[0];
  if (!originalEnvelope || !binding.blobKekTargets) {
    throw new Error("Expected blob target fixture");
  }
  const secondBindingId = "550e8400-e29b-41d4-a716-446655440562";
  const secondEnvelope = {
    ...originalEnvelope,
    bindingId: secondBindingId,
  };
  const targets = [originalEnvelope, secondEnvelope].map((target) => ({
    bindingId: target.bindingId,
    containerId: target.containerId,
    containerKeyEpoch: target.containerKeyEpoch,
    containerKeyEpochId: target.containerKeyEpochId,
    containerManifestHash: target.containerManifestHash,
    documentId: target.documentId,
  }));
  const targetHash = await computeBlobContentKeyTargetHash(targets);
  const currentTargets = {
    ...binding.blobKekTargets,
    activeBindingIds: [binding.bindingId, secondBindingId],
    blobKeyTargetHash: targetHash,
    targets,
  };
  const blobAccessManifestHash = await computeBlobAccessManifestHash({
    version: 1,
    activeBindingIds: currentTargets.activeBindingIds,
    blobId: currentTargets.blobId,
    blobKeyTargetHash: currentTargets.blobKeyTargetHash,
    documentManifestHashes: currentTargets.documentManifestHashes,
    linkedContainerKeyEpochIds: currentTargets.linkedContainerKeyEpochIds,
    linkedContainerManifestHashes: currentTargets.linkedContainerManifestHashes,
    organizationId: currentTargets.organizationId,
  });

  const advancedBinding = {
    ...binding,
    blobKekTargets: { ...currentTargets, blobAccessManifestHash },
    contentKeyBundle: {
      ...binding.contentKeyBundle,
      targetHash,
      targets: [originalEnvelope, secondEnvelope],
    },
    writeAuthorization: binding.blobKekTargets,
  };
  const decryptInput = {
    binding: advancedBinding,
    encryptedBytes: fixture.stagedBlob.encryptedBytes,
    expectedDocumentId: fixture.writerProjection.documentId,
    expectedSlotId: fixture.attachment.slotId,
    execSql: fixture.execSql,
    resolveProjectionUserKey: fixture.resolveProjectionUserKey,
    targetSecretKey: fixture.secretKey,
    writerProjection: fixture.writerProjection,
  };
  const decrypted = await decryptDocumentAttachmentBlob(decryptInput);

  expect(Array.from(decrypted)).toEqual(Array.from(fixture.bytes));
  const { writeAuthorization: _legacyRow, ...legacyBinding } = advancedBinding;
  await expect(
    decryptDocumentAttachmentBlob({
      ...decryptInput,
      binding: legacyBinding,
    }),
  ).rejects.toThrow(
    "write header access manifest hash does not match expected hash",
  );
});

test("decryptDocumentAttachmentBlob accepts a binding created after the blob write", async () => {
  const fixture = await createUploadedAttachmentFixture();
  const bindingId = "550e8400-e29b-41d4-a716-446655440563";
  const slotId = "preview-rebound";
  const multipart = createMultipartBlobStageFixture();
  const rebound = await uploadDocumentAttachment({
    apiClient: {
      ...multipart,
      bindBlobAttachment: async (_blobId, request) =>
        createBlobAttachmentBindResponse({
          blobId: fixture.blobId,
          documentManifest: fixture.writerProjection.documentManifest,
          request,
        }),
      getDocumentWriterProjection: async () => fixture.writerProjection,
    },
    author: fixture.author,
    bindingId,
    blobId: fixture.blobId,
    bytes: fixture.bytes,
    contentKey: fixture.contentKey,
    documentId: fixture.writerProjection.documentId,
    execSql: fixture.execSql,
    expectedBindingId: null,
    resolveProjectionUserKey: fixture.resolveProjectionUserKey,
    signedAt: "2026-04-27T00:01:00.000Z",
    slotId,
    targetSecretKey: fixture.secretKey,
  });
  if (!rebound) {
    throw new Error("Expected rebound attachment fixture");
  }
  const binding = {
    bindingEvent: rebound.response.bindingEvent,
    bindingId,
    blobId: fixture.blobId,
    blobKekTargets: rebound.response.blobKekTargets,
    contentKeyBundle: rebound.response.contentKeyBundle,
    documentManifestHash: rebound.response.documentManifestHash,
    previousBindingId: rebound.response.previousBindingId,
    slotId,
    writeAuthorization: fixture.uploaded.response.writeAuthorization,
    writeHeader: fixture.uploaded.response.writeHeader,
  };

  const decrypted = await decryptDocumentAttachmentBlob({
    binding,
    encryptedBytes: fixture.stagedBlob.encryptedBytes,
    expectedDocumentId: fixture.writerProjection.documentId,
    expectedSlotId: slotId,
    execSql: fixture.execSql,
    resolveProjectionUserKey: fixture.resolveProjectionUserKey,
    targetSecretKey: fixture.secretKey,
    writerProjection: fixture.writerProjection,
  });

  expect(Array.from(decrypted)).toEqual(Array.from(fixture.bytes));
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
      binding: createFixtureBinding(fixture),
      encryptedBytes: fixture.stagedBlob.encryptedBytes,
      expectedDocumentId: fixture.writerProjection.documentId,
      expectedSlotId: fixture.attachment.slotId,
      execSql: fixture.execSql,
      resolveProjectionUserKey: fixture.resolveProjectionUserKey,
      targetSecretKey: fixture.secretKey,
      writerProjection: tamperedProjection,
    }),
  ).rejects.toThrow("Document writer projection signature verification failed");
});

test("hydrateDocumentAttachmentBlobs rejects a binding reused for another slot", async () => {
  const fixture = await createUploadedAttachmentFixture();
  const secondAttachment: DocumentAttachment = {
    ...fixture.attachment,
    slotId: "preview-copy",
  };
  let blobByteReads = 0;
  let writerProjectionCalls = 0;

  await expect(
    hydrateDocumentAttachmentBlobs({
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
      targetSecretKey: fixture.secretKey,
    }),
  ).rejects.toThrow("slot or event hash is inconsistent");

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
        {
          bindingEvent: uploaded.response.bindingEvent,
          bindingId,
          blobId,
          blobKekTargets: uploaded.response.blobKekTargets,
          contentKeyBundle: uploaded.response.contentKeyBundle,
          documentManifestHash: uploaded.response.documentManifestHash,
          previousBindingId: uploaded.response.previousBindingId,
          slotId,
          writeAuthorization: uploaded.response.writeAuthorization,
          writeHeader: uploaded.response.writeHeader,
        },
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

test("decryptDocumentAttachmentBlob rejects an unauthorized blob writer", async () => {
  const fixture = await createUploadedAttachmentFixture();
  const binding = createFixtureBinding(fixture);
  const originalHeader = readWriteHeader(
    binding.writeHeader,
    "Uploaded blob write header",
  );
  const { signature: _signature, ...unsignedHeader } = originalHeader;
  const signing = generateSigningSeedAndKeyPair();
  const kem = generateKemSeedAndKeyPair();
  const writerUserId = "unauthorized-blob-writer";
  const writerKeyFingerprint = await toFingerprint(signing.signingPublicKey);
  const writeHeader = await signWriteHeader(
    { ...unsignedHeader, writerKeyFingerprint, writerUserId },
    signing.signingPrivateKey,
  );

  await expect(
    decryptDocumentAttachmentBlob({
      binding: { ...binding, writeHeader: { ...writeHeader } },
      encryptedBytes: fixture.stagedBlob.encryptedBytes,
      expectedDocumentId: fixture.writerProjection.documentId,
      expectedSlotId: fixture.attachment.slotId,
      execSql: fixture.execSql,
      resolveProjectionUserKey: async (userId) =>
        userId === writerUserId
          ? createTestTrustedUserIdentity({
              encapsulationPublicKey: kem.publicKey,
              signingKeyFingerprint: writerKeyFingerprint,
              signingPublicKey: signing.signingPublicKey,
              userId,
            })
          : fixture.resolveProjectionUserKey(userId),
      targetSecretKey: fixture.secretKey,
      writerProjection: fixture.writerProjection,
    }),
  ).rejects.toThrow("lacks write access through a committed blob target");
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

import { expect, test } from "bun:test";
import { uploadDocumentAttachment } from "@tearleads/client-sdk";
import {
  type AccessEvent,
  BLOB_CONTENT_KEY_WRAP_SUITE,
  computeBlobAccessManifestHash,
  computeWriteHeaderHash,
  type WriteHeader,
} from "@tearleads/crypto";
import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import {
  createParentProjection,
  createParentProjectionUserKeyResolver,
  substituteFirstProjectionUserWrapMaterial,
} from "../../../test/helpers/containerFixtures";
import {
  createMaterializedSyncFixture,
  createResponse,
} from "../../../test/helpers/documentFixtures";
import type { BlobBytes } from "../../data/blobContracts";
import { buildMaterializedDocumentCreatePlan } from "../documents/create";

test("uploadDocumentAttachment wraps blob keys with the blob content-key suite", async () => {
  const { author, resolveProjectionUserKey, secretKey, writerProjection } =
    await createMaterializedSyncFixture();
  const blobId = "550e8400-e29b-41d4-a716-446655440555";
  const bindingId = "550e8400-e29b-41d4-a716-446655440556";
  const slotId = "preview";
  const submittedResponses: {
    readonly contentKeyBundle: {
      readonly targets: readonly { readonly wrappingMetadata: unknown }[];
    };
  }[] = [];
  let stagedEncryptedRecord: Record<string, unknown> | null = null;

  const uploaded = await uploadDocumentAttachment({
    apiClient: {
      bindBlobAttachment: async (_blobId, request) => {
        const targets = request.contentKeyBundle.targets;
        const targetRecords = targets.map((target) => ({ ...target }));
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
        const response = {
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
            targets: targetRecords,
            blobKeyTargetHash: request.contentKeyBundle.targetHash,
            blobAccessManifestHash,
          },
          writeHeaderHash: await computeWriteHeaderHash(
            request.stagedBlob.writeHeader as unknown as WriteHeader,
          ),
        };
        submittedResponses.push(response);
        return response;
      },
      getDocumentWriterProjection: async () => writerProjection,
      stageBlob: async (request) => {
        stagedEncryptedRecord = JSON.parse(request.encryptedBytes) as Record<
          string,
          unknown
        >;
        return {
          stageId: "stage-blob-suite",
          expiresAt: "2026-04-27T01:00:00.000Z",
        };
      },
    },
    author,
    bindingId,
    blobId,
    bytes: new Uint8Array([1, 2, 3, 4]) as BlobBytes,
    documentId: writerProjection.documentId,
    expectedBindingId: null,
    resolveProjectionUserKey,
    signedAt: "2026-04-27T00:00:00.000Z",
    slotId,
    targetSecretKey: secretKey,
  });

  expect(uploaded?.blobId).toBe(blobId);
  if (!stagedEncryptedRecord) {
    throw new Error("Expected staged encrypted blob record.");
  }
  expect(stagedEncryptedRecord).not.toHaveProperty("contentKeyBundle");
  expect(stagedEncryptedRecord).not.toHaveProperty("targetHash");
  expect(submittedResponses[0]?.contentKeyBundle.targets).toEqual([
    expect.objectContaining({
      wrappingMetadata: expect.objectContaining({
        suite: BLOB_CONTENT_KEY_WRAP_SUITE,
      }),
    }),
  ]);
});

test("uploadDocumentAttachment can stage encrypted bytes with multipart uploads", async () => {
  const { author, resolveProjectionUserKey, secretKey, writerProjection } =
    await createMaterializedSyncFixture();
  const blobId = "550e8400-e29b-41d4-a716-446655440565";
  const bindingId = "550e8400-e29b-41d4-a716-446655440566";
  const slotId = "preview";
  const uploadedParts: { encryptedBytes: string; partNumber: number }[] = [];
  const completedParts: unknown[] = [];
  let activeUploads = 0;
  let maxActiveUploads = 0;

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
      completeMultipartBlobStage: async (stageId, request) => {
        completedParts.push(...request.parts);
        return {
          byteLength: uploadedParts.reduce(
            (total, part) =>
              total + new TextEncoder().encode(part.encryptedBytes).byteLength,
            0,
          ),
          expiresAt: "2026-04-27T01:00:00.000Z",
          sha256: "multipart-sha256",
          stageId,
        };
      },
      getDocumentWriterProjection: async () => writerProjection,
      getMultipartBlobStage: async () => null,
      initiateMultipartBlobStage: async (request) => ({
        ...request,
        expiresAt: "2026-04-27T01:00:00.000Z",
        stageId: "stage-multipart-upload",
        uploadId: "upload-multipart-upload",
        uploadedParts: [],
      }),
      stageBlob: async () => {
        throw new Error("Expected multipart upload path");
      },
      uploadMultipartBlobPart: async () => {
        throw new Error("Expected streamed multipart upload path");
      },
      uploadMultipartBlobPartBytes: async (_stageId, partNumber, request) => {
        activeUploads += 1;
        maxActiveUploads = Math.max(maxActiveUploads, activeUploads);

        try {
          await new Promise((resolve) => setTimeout(resolve, 0));
          const encryptedBytes = await new Response(
            request.encryptedBytes,
          ).text();
          expect(request.byteLength).toBe(
            new TextEncoder().encode(encryptedBytes).byteLength,
          );
          expect(request.sha256).toMatch(/^[0-9a-f]{64}$/);
          uploadedParts.push({
            encryptedBytes,
            partNumber,
          });

          return {
            part: {
              byteLength: request.byteLength,
              etag: `etag-${partNumber}`,
              partNumber,
            },
            stageId: "stage-multipart-upload",
            uploadId: request.uploadId,
          };
        } finally {
          activeUploads -= 1;
        }
      },
    },
    author,
    bindingId,
    blobId,
    bytes: new Uint8Array(
      Array.from({ length: 128 }, (_, index) => index),
    ) as BlobBytes,
    documentId: writerProjection.documentId,
    expectedBindingId: null,
    multipart: { partSize: 64, uploadConcurrency: 2 },
    resolveProjectionUserKey,
    signedAt: "2026-04-27T00:00:00.000Z",
    slotId,
    targetSecretKey: secretKey,
  });

  expect(uploaded?.blobId).toBe(blobId);
  expect(uploaded?.request.stagedBlob?.stageId).toBe("stage-multipart-upload");
  const multipartEncryptedRecord = JSON.parse(
    uploadedParts
      .toSorted((left, right) => left.partNumber - right.partNumber)
      .map((part) => part.encryptedBytes)
      .join(""),
  ) as Record<string, unknown>;
  expect(multipartEncryptedRecord).not.toHaveProperty("contentKeyBundle");
  expect(multipartEncryptedRecord).not.toHaveProperty("targetHash");
  expect(uploadedParts.length).toBeGreaterThan(2);
  expect(maxActiveUploads).toBe(2);
  expect(completedParts).toEqual(
    uploadedParts
      .map((part) => ({
        etag: `etag-${part.partNumber}`,
        partNumber: part.partNumber,
      }))
      .sort((left, right) => left.partNumber - right.partNumber),
  );
});

test("uploadDocumentAttachment rejects document writer projections with bad signatures before staging", async () => {
  const { author, resolveProjectionUserKey, secretKey, writerProjection } =
    await createMaterializedSyncFixture();
  const tamperedProjection = structuredClone(writerProjection);
  const signedEvent = tamperedProjection.documentManifest.event
    .event as unknown as AccessEvent;
  const signature = signedEvent.signature;
  if (typeof signature !== "string" || signature.length === 0) {
    throw new Error("Expected signed document event fixture");
  }
  signedEvent.signature = `${signature.slice(0, -1)}${
    signature.endsWith("A") ? "B" : "A"
  }`;
  let stageCalled = false;
  let bindCalled = false;

  await expect(
    uploadDocumentAttachment({
      apiClient: {
        bindBlobAttachment: async () => {
          bindCalled = true;
          throw new Error("Unexpected bind");
        },
        getDocumentWriterProjection: async () => tamperedProjection,
        stageBlob: async () => {
          stageCalled = true;
          throw new Error("Unexpected stage");
        },
      },
      author,
      blobId: "550e8400-e29b-41d4-a716-446655440557",
      bytes: new Uint8Array([5, 6, 7]) as BlobBytes,
      documentId: writerProjection.documentId,
      expectedBindingId: null,
      resolveProjectionUserKey,
      signedAt: "2026-04-27T00:00:00.000Z",
      slotId: "preview",
      targetSecretKey: secretKey,
    }),
  ).rejects.toThrow("Document writer projection signature verification failed");
  expect(stageCalled).toBe(false);
  expect(bindCalled).toBe(false);
});

test("uploadDocumentAttachment rejects substituted KEK material before staging", async () => {
  const parent = await createParentProjection();
  const resolveProjectionUserKey =
    createParentProjectionUserKeyResolver(parent);
  const materializedCreate = await buildMaterializedDocumentCreatePlan({
    author: parent.author,
    containerProjection: parent.projection,
    contentKey: crypto.getRandomValues(new Uint8Array(32)),
    documentId: "550e8400-e29b-41d4-a716-446655440112",
    eventId: "event-substituted-kek-blob",
    resolveProjectionUserKey,
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: parent.secretKey,
  });
  const response = createResponse(materializedCreate.plan);
  const tamperedProjection = await substituteFirstProjectionUserWrapMaterial({
    projection: parent.projection,
    publicKey: parent.encapsulationPublicKey,
    userId: parent.userId,
  });
  const writerProjection: DocumentWriterProjectionResponse = {
    authorizingContainerPaths: [tamperedProjection],
    contentKeyBundle: response.contentKeyBundle,
    documentId: response.id,
    documentKekTargets: response.documentKekTargets,
    documentManifest: response.accessManifest,
  };
  let stageCalled = false;
  let bindCalled = false;

  await expect(
    uploadDocumentAttachment({
      apiClient: {
        bindBlobAttachment: async () => {
          bindCalled = true;
          throw new Error("Unexpected bind");
        },
        getDocumentWriterProjection: async () => writerProjection,
        stageBlob: async () => {
          stageCalled = true;
          throw new Error("Unexpected stage");
        },
      },
      author: parent.author,
      blobId: "550e8400-e29b-41d4-a716-446655440113",
      bytes: new Uint8Array([8, 9, 10]) as BlobBytes,
      documentId: writerProjection.documentId,
      expectedBindingId: null,
      resolveProjectionUserKey,
      signedAt: "2026-04-27T00:00:00.000Z",
      slotId: "preview",
      targetSecretKey: parent.secretKey,
    }),
  ).rejects.toThrow("KEK material does not match committed epoch id");
  expect(stageCalled).toBe(false);
  expect(bindCalled).toBe(false);
});

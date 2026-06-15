import { expect, test } from "bun:test";
import {
  computeBlobAccessManifestHash,
  computeWriteHeaderHash,
  type WriteHeader,
} from "@tearleads/crypto";
import { createMaterializedSyncFixture } from "../../../test/helpers/documentFixtures";
import type { BlobBytes } from "../../data/blobContracts";
import { uploadDocumentAttachment } from "./upload";

test("uploadDocumentAttachment automatically uses multipart for large durable blob uploads", async () => {
  const { author, resolveProjectionUserKey, secretKey, writerProjection } =
    await createMaterializedSyncFixture();
  const blobId = "550e8400-e29b-41d4-a716-446655440575";
  const bindingId = "550e8400-e29b-41d4-a716-446655440576";
  const slotId = "preview";
  const uploadedParts: { encryptedBytes: string; partNumber: number }[] = [];
  let capabilityRequests = 0;
  let legacyStageCalled = false;

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
      completeMultipartBlobStage: async (stageId, request) => ({
        byteLength: uploadedParts.reduce(
          (total, part) =>
            total + new TextEncoder().encode(part.encryptedBytes).byteLength,
          0,
        ),
        expiresAt: "2026-04-27T01:00:00.000Z",
        sha256: request.uploadId,
        stageId,
      }),
      getBlobUploadCapabilities: async () => {
        capabilityRequests += 1;
        return { multipart: { durable: true, enabled: true } };
      },
      getDocumentWriterProjection: async () => writerProjection,
      getMultipartBlobStage: async () => null,
      initiateMultipartBlobStage: async (request) => ({
        ...request,
        expiresAt: "2026-04-27T01:00:00.000Z",
        stageId: "stage-auto-multipart-upload",
        uploadId: "upload-auto-multipart-upload",
        uploadedParts: [],
      }),
      stageBlob: async () => {
        legacyStageCalled = true;
        return null;
      },
      uploadMultipartBlobPart: async () => {
        throw new Error("Expected streamed multipart upload path");
      },
      uploadMultipartBlobPartBytes: async (_stageId, partNumber, request) => {
        const encryptedBytes = await new Response(
          request.encryptedBytes,
        ).text();
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
          stageId: "stage-auto-multipart-upload",
          uploadId: request.uploadId,
        };
      },
    },
    author,
    bindingId,
    blobId,
    bytes: new Uint8Array(8 * 1024 * 1024) as BlobBytes,
    documentId: writerProjection.documentId,
    expectedBindingId: null,
    resolveProjectionUserKey,
    signedAt: "2026-04-27T00:00:00.000Z",
    slotId,
    targetSecretKey: secretKey,
  });

  expect(uploaded?.request.stagedBlob?.stageId).toBe(
    "stage-auto-multipart-upload",
  );
  expect(capabilityRequests).toBe(1);
  expect(legacyStageCalled).toBe(false);
  expect(uploadedParts.length).toBeGreaterThan(1);
});

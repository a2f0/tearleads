import { expect, test } from "bun:test";
import {
  computeBlobAccessManifestHash,
  computeWriteHeaderHash,
  type WriteHeader,
} from "@tearleads/crypto";
import type { BlobBytes } from "../../data/blobs";
import type { DocumentAttachment } from "../../data/documents/documentContent";
import { createMaterializedSyncFixture } from "../../data/documents/documentTestFixtures";
import {
  hydrateDocumentAttachmentBlobs,
  uploadDocumentAttachment,
} from "./index";

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

test("hydrateDocumentAttachmentBlobs downloads and decrypts remote attachment bytes", async () => {
  const fixture = await createUploadedAttachmentFixture();

  const hydratedBlobs = await hydrateDocumentAttachmentBlobs({
    apiClient: {
      getBlob: async (blobId) => ({
        blobId,
        encryptedBytes: fixture.stagedBlob.encryptedBytes,
        sha256: fixture.stagedBlob.sha256,
      }),
      getDocumentWriterProjection: async () => fixture.writerProjection,
      listDocumentAttachments: async () => [
        {
          bindingId: fixture.bindingId,
          blobId: fixture.blobId,
          slotId: fixture.attachment.slotId,
        },
      ],
    },
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
    slotId: fixture.attachment.slotId,
  });
  expect(hydratedBlob?.storageKey).toBe(`blob-${fixture.blobId}`);
  expect(Array.from(hydratedBlob?.bytes ?? [])).toEqual(
    Array.from(fixture.bytes),
  );
});

test("hydrateDocumentAttachmentBlobs skips blobs with a digest mismatch", async () => {
  const fixture = await createUploadedAttachmentFixture();
  const logs: string[] = [];

  const hydratedBlobs = await hydrateDocumentAttachmentBlobs({
    apiClient: {
      getBlob: async (blobId) => ({
        blobId,
        encryptedBytes: fixture.stagedBlob.encryptedBytes,
        sha256: "bad-sha256",
      }),
      getDocumentWriterProjection: async () => {
        throw new Error("Unexpected writer projection lookup");
      },
      listDocumentAttachments: async () => [
        {
          bindingId: fixture.bindingId,
          blobId: fixture.blobId,
          slotId: fixture.attachment.slotId,
        },
      ],
    },
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

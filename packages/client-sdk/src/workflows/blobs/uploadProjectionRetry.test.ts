import { expect, test } from "bun:test";
import { uploadDocumentAttachment } from "@tearleads/client-sdk";
import {
  computeBlobAccessManifestHash,
  computeWriteHeaderHash,
  generateKemSeedAndKeyPair,
  type WriteHeader,
} from "@tearleads/crypto";
import { createContainerWriterProjectionFixture } from "@tearleads/test-utils";
import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import {
  createMaterializedSyncFixture,
  createResponse,
} from "../../../test/helpers/documentFixtures";
import type { BlobBytes } from "../../data/blobContracts";
import { buildMaterializedDocumentCreatePlan } from "../documents/create";

test("uploadDocumentAttachment refetches writer projection after a stale container KEK unwrap", async () => {
  const {
    author,
    projection,
    resolveProjectionUserKey,
    secretKey,
    writerProjection,
  } = await createMaterializedSyncFixture();
  const staleKeyPair = generateKemSeedAndKeyPair();
  const staleProjection = await createContainerWriterProjectionFixture({
    containerId: projection.containerId,
    encapsulationPublicKey: staleKeyPair.publicKey,
    organizationId: author.organizationId,
    signerKeyFingerprint: author.signerKeyFingerprint,
    signerPrivateKey: author.signerPrivateKey,
    userId: author.signerUserId,
  });
  let useFreshProjectionKey = false;
  const resolveProjectionUserKeyWithStaleUser = async (userId: string) => {
    const resolved = await resolveProjectionUserKey(userId);
    if (!resolved || userId !== author.signerUserId) {
      return resolved;
    }

    return useFreshProjectionKey
      ? resolved
      : {
          ...resolved,
          encapsulationPublicKey: staleKeyPair.publicKey,
        };
  };
  const staleCreate = await buildMaterializedDocumentCreatePlan({
    author,
    containerProjection: staleProjection,
    documentId: writerProjection.documentId,
    eventId: "event-stale-blob-upload",
    resolveProjectionUserKey: resolveProjectionUserKeyWithStaleUser,
    targetSecretKey: staleKeyPair.secretKey,
  });
  const staleResponse = createResponse(staleCreate.plan);
  const staleWriterProjection: DocumentWriterProjectionResponse = {
    authorizingContainerPaths: [staleProjection],
    contentKeyBundle: staleResponse.contentKeyBundle,
    documentId: staleResponse.id,
    documentKekTargets: staleResponse.documentKekTargets,
    documentManifest: staleResponse.accessManifest,
  };
  const blobId = "550e8400-e29b-41d4-a716-446655440565";
  const bindingId = "550e8400-e29b-41d4-a716-446655440566";
  const slotId = "preview";
  const evictedDocumentIds: string[] = [];
  let projectionRequestCount = 0;
  let stageCount = 0;

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
          blobKekTargets: {
            activeBindingIds: [bindingId],
            blobAccessManifestHash,
            blobId,
            blobKeyTargetHash: request.contentKeyBundle.targetHash,
            documentManifestHashes: [
              writerProjection.documentManifest.manifestHash,
            ],
            linkedContainerKeyEpochIds,
            linkedContainerManifestHashes,
            organizationId: author.organizationId,
            targets: targets.map((target) => ({ ...target })),
          },
          contentKeyBundle: {
            blobId,
            ...request.contentKeyBundle,
          },
          documentId: writerProjection.documentId,
          slotId,
          writeHeaderHash: await computeWriteHeaderHash(
            request.stagedBlob.writeHeader as unknown as WriteHeader,
          ),
        };
      },
      evictDocumentWriterProjection: (documentId) => {
        evictedDocumentIds.push(documentId);
        useFreshProjectionKey = true;
      },
      getDocumentWriterProjection: async (documentId) => {
        if (documentId !== writerProjection.documentId) {
          return null;
        }

        projectionRequestCount += 1;
        return projectionRequestCount === 1
          ? staleWriterProjection
          : writerProjection;
      },
      stageBlob: async () => {
        stageCount += 1;
        return {
          stageId: "stage-stale-blob-upload",
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
    resolveProjectionUserKey: resolveProjectionUserKeyWithStaleUser,
    slotId,
    targetSecretKey: secretKey,
  });

  expect(uploaded?.writerProjection).toBe(writerProjection);
  expect(evictedDocumentIds).toEqual([writerProjection.documentId]);
  expect(projectionRequestCount).toBe(2);
  expect(stageCount).toBe(1);
  expect(uploaded?.bindingId).toBe(bindingId);
});

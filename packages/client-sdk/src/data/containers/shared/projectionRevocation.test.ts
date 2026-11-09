import { expect, test } from "bun:test";
import {
  type AccessEvent,
  BLOB_CONTENT_KEY_WRAP_SUITE,
  computeAccessEventHash,
  computeBlobAccessManifestHash,
  computeWriteHeaderHash,
  unwrapContentKey,
  type WriteHeader,
} from "@tearleads/crypto";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import { createTestExecSql } from "@tearleads/test-utils";
import { createMultipartBlobStageFixture } from "../../../../test/helpers/blobUploadFixtures";
import { SIGNED_AT } from "../../../../test/helpers/containerFixtures";
import {
  createDocumentAfterRevoke,
  createRevokedRotationFixture,
} from "../../../../test/helpers/revokedKekRotation";
import { uploadDocumentAttachment } from "../../../workflows/blobs/upload";
import type { BlobBytes } from "../../blobs/blobContracts";
import { unwrapContainerKekPath } from "../../documents/shared/containerKek/containerKekPath";
import { unwrapDocumentContentKeyTarget } from "../../documents/shared/projection/projectionContentKeys";

test("unwrapContainerKekPath rejects revoked users after KEK epoch rotation", async () => {
  const { close: closeProjectionDb, execSql } = await createTestExecSql(
    "projection-revoked-user",
  );

  try {
    const {
      parent,
      resolveProjectionUserKey,
      revokedKeyPair,
      revokedManifest,
      revokedProjection,
      rotatedContainerKek,
      rotatedContainerKeyEpochId,
      rotatedKekState,
      verifiedRotatedKek,
    } = await createRevokedRotationFixture(execSql);
    expect(verifiedRotatedKek.ok).toBe(true);

    expect(revokedManifest.state.directGrants).toEqual([
      {
        subjectType: "user",
        subjectId: parent.userId,
        accessLevel: "admin",
      },
    ]);
    expect(
      rotatedKekState.recipientTargets.map((target) => target.recipientId),
    ).toEqual([parent.userId]);
    const ownerRotatedKeks = await unwrapContainerKekPath({
      execSql,
      projection: revokedProjection,
      resolveProjectionUserKey,
      secretKey: parent.secretKey,
    });
    expect(
      Array.from(ownerRotatedKeks.get(rotatedContainerKeyEpochId) ?? []),
    ).toEqual(Array.from(rotatedContainerKek));

    const preparedRewrapKeks = await unwrapContainerKekPath({
      execSql,
      knownContainerKeks: new Map([
        [rotatedContainerKeyEpochId, rotatedContainerKek],
      ]),
      projection: revokedProjection,
      resolveProjectionUserKey,
      secretKey: revokedKeyPair.secretKey,
    });
    expect(
      Array.from(
        preparedRewrapKeks.get(parent.parentKekState.containerKeyEpochId) ?? [],
      ),
    ).toEqual(Array.from(parent.parentContainerKek));

    const substitutedProjection = structuredClone(revokedProjection);
    const substitutedKeyring = substitutedProjection.containerKeks[0]?.keyring;
    if (!substitutedKeyring) {
      throw new Error("Expected projected rotation keyring");
    }
    const tamperedSealed = base64ToBytes(substitutedKeyring.sealed);
    tamperedSealed[8] = (tamperedSealed[8] ?? 0) ^ 0xff;
    Reflect.set(substitutedKeyring, "sealed", bytesToBase64(tamperedSealed));
    const ownerKeksWithCorruptHistory = await unwrapContainerKekPath({
      execSql,
      projection: substitutedProjection,
      resolveProjectionUserKey,
      secretKey: parent.secretKey,
    });
    expect(ownerKeksWithCorruptHistory.get(rotatedContainerKeyEpochId)).toEqual(
      rotatedContainerKek,
    );
    expect(
      ownerKeksWithCorruptHistory.has(
        parent.parentKekState.containerKeyEpochId,
      ),
    ).toBe(false);

    await expect(
      unwrapContainerKekPath({
        execSql,
        projection: revokedProjection,
        resolveProjectionUserKey,
        secretKey: revokedKeyPair.secretKey,
      }),
    ).rejects.toThrow("could not be unwrapped");
  } finally {
    closeProjectionDb();
  }
});

test("documents created after a revoking KEK rotation wrap only the rotated KEK", async () => {
  const { close: closeProjectionDb, execSql } = await createTestExecSql(
    "projection-revoked-user",
  );

  try {
    const fixture = await createRevokedRotationFixture(execSql);
    const {
      parent,
      previousContainerKek,
      revokedManifest,
      rotatedContainerKek,
      rotatedContainerKeyEpochId,
    } = fixture;
    const { contentKey, createdDocument, createdDocumentId } =
      await createDocumentAfterRevoke(execSql, fixture);
    const [targetEnvelope] =
      createdDocument.plan.request.contentKeyBundle.targets;
    if (!targetEnvelope) {
      throw new Error("Expected document content-key target");
    }
    expect(createdDocument.plan.targets).toEqual([
      {
        containerId: parent.projection.containerId,
        containerManifestHash: revokedManifest.manifestHash,
        containerKeyEpoch: 2,
        containerKeyEpochId: rotatedContainerKeyEpochId,
      },
    ]);
    const sealedFor = { contentKeyEpoch: 1, documentId: createdDocumentId };
    const ownerContentKey = await unwrapDocumentContentKeyTarget({
      containerKek: rotatedContainerKek,
      ...sealedFor,
      envelope: targetEnvelope,
    });
    expect(Array.from(ownerContentKey)).toEqual(Array.from(contentKey));
    await expect(
      unwrapDocumentContentKeyTarget({
        containerKek: previousContainerKek,
        ...sealedFor,
        envelope: targetEnvelope,
      }),
    ).rejects.toThrow();
  } finally {
    closeProjectionDb();
  }
});

test("blobs uploaded after a revoking KEK rotation wrap only the rotated KEK", async () => {
  const { close: closeProjectionDb, execSql } = await createTestExecSql(
    "projection-revoked-user",
  );

  try {
    const fixture = await createRevokedRotationFixture(execSql);
    const {
      parent,
      previousContainerKek,
      resolveProjectionUserKey,
      revokedManifest,
      rotatedContainerKek,
      rotatedContainerKeyEpochId,
    } = fixture;
    const { createdDocument, documentWriterProjection } =
      await createDocumentAfterRevoke(execSql, fixture);
    const blobId = "550e8400-e29b-41d4-a716-446655440701";
    const bindingId = "550e8400-e29b-41d4-a716-446655440702";
    const slotId = "preview-after-revoke";
    const blobContentKey = crypto.getRandomValues(new Uint8Array(32));
    const multipart = createMultipartBlobStageFixture({
      stageId: "stage-blob-after-revoke",
    });
    const uploadedBlob = await uploadDocumentAttachment({
      apiClient: {
        ...multipart,
        bindBlobAttachment: async (_blobId, request) => {
          const targets = request.contentKeyBundle.targets;
          const linkedContainerManifestHashes = [
            ...new Set(targets.map((target) => target.containerManifestHash)),
          ].sort();
          const linkedContainerKeyEpochIds = [
            ...new Set(targets.map((target) => target.containerKeyEpochId)),
          ].sort();
          if (!request.stagedBlob) {
            throw new Error("Expected staged blob request");
          }
          const blobAccessManifestHash = await computeBlobAccessManifestHash({
            version: 1,
            blobId,
            organizationId: parent.projection.organizationId,
            activeBindingIds: [bindingId],
            documentManifestHashes: [createdDocument.plan.manifestHash],
            linkedContainerManifestHashes,
            linkedContainerKeyEpochIds,
            blobKeyTargetHash: request.contentKeyBundle.targetHash,
          });
          const writeHeaderHash = await computeWriteHeaderHash(
            request.stagedBlob.writeHeader as unknown as WriteHeader,
          );
          return {
            bindingId,
            blobAccessManifestHash,
            blobId,
            blobKeyTargetHash: request.contentKeyBundle.targetHash,
            contentKeyEpoch: request.contentKeyBundle.contentKeyEpoch,
            documentId: createdDocument.plan.documentId,
            documentManifestHash: createdDocument.plan.manifestHash,
            eventHash: await computeAccessEventHash(
              request.event as unknown as AccessEvent,
            ),
            previousBindingId: null,
            slotId,
            writeHeaderHash,
          };
        },
        getDocumentWriterProjection: async (documentId) =>
          documentId === createdDocument.plan.documentId
            ? documentWriterProjection
            : null,
      },
      author: parent.author,
      bindingId,
      blobId,
      bytes: new Uint8Array([1, 2, 3, 4]) as BlobBytes,
      contentKey: blobContentKey,
      documentId: createdDocument.plan.documentId,
      execSql,
      expectedBindingId: null,
      resolveProjectionUserKey,
      signedAt: SIGNED_AT,
      slotId,
      targetSecretKey: parent.secretKey,
    });
    if (!uploadedBlob) {
      throw new Error("Expected blob attachment upload");
    }
    const [blobTargetEnvelope] = uploadedBlob.request.contentKeyBundle.targets;
    if (!blobTargetEnvelope) {
      throw new Error("Expected blob content-key target");
    }
    const blobWrappingMetadata = blobTargetEnvelope.wrappingMetadata;
    if (
      !blobWrappingMetadata ||
      typeof blobWrappingMetadata !== "object" ||
      Array.isArray(blobWrappingMetadata)
    ) {
      throw new Error("Expected blob wrapping metadata");
    }
    const blobWrapSuite = Reflect.get(blobWrappingMetadata, "suite");
    const blobWrapIv = Reflect.get(blobWrappingMetadata, "iv");
    expect(blobWrapSuite).toBe(BLOB_CONTENT_KEY_WRAP_SUITE);
    if (typeof blobWrapIv !== "string" || blobWrapIv.length === 0) {
      throw new Error("Expected blob wrapping IV");
    }
    expect(blobTargetEnvelope).toEqual(
      expect.objectContaining({
        containerManifestHash: revokedManifest.manifestHash,
        containerKeyEpoch: 2,
        containerKeyEpochId: rotatedContainerKeyEpochId,
      }),
    );
    const blobWrap = {
      iv: base64ToBytes(blobWrapIv),
      ciphertext: base64ToBytes(blobTargetEnvelope.wrappedKey),
    };
    const blobSealedFor = {
      ...blobTargetEnvelope,
      kind: "Blob",
      objectId: blobId,
      contentKeyEpoch: uploadedBlob.request.contentKeyBundle.contentKeyEpoch,
    } as const;
    const ownerBlobContentKey = await unwrapContentKey(
      blobWrap,
      rotatedContainerKek,
      blobSealedFor,
    );
    expect(Array.from(ownerBlobContentKey)).toEqual(Array.from(blobContentKey));
    await expect(
      unwrapContentKey(blobWrap, previousContainerKek, blobSealedFor),
    ).rejects.toThrow();
  } finally {
    closeProjectionDb();
  }
});

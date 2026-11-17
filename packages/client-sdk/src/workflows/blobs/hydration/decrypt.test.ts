import { expect, test } from "bun:test";
import {
  type AccessEvent,
  computeBlobAccessManifestHash,
  computeBlobContentKeyTargetHash,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  signWriteHeader,
  toFingerprint,
} from "@tearleads/crypto";
import {
  createBlobAttachmentBindResponse,
  createMultipartBlobStageFixture,
} from "../../../../test/helpers/data/blobUploadFixtures";
import { createTestTrustedUserIdentity } from "../../../../test/helpers/data/trustedUserIdentity";
import { createBlobAttachmentServiceFixture } from "../../../../test/helpers/workflows/blobAttachmentServiceFixture";
import {
  createFixtureBinding,
  createUploadedAttachmentFixture,
  stagedBindingSummary,
} from "../../../../test/helpers/workflows/blobHydration";
import { readWriteHeader } from "../../../data/documents/shared/readers";

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
  const blobs = createBlobAttachmentServiceFixture({
    api: {},
    encapsulationSecretKey: fixture.secretKey,
    execSql: fixture.execSql,
  });
  const decryptInput = {
    binding: advancedBinding,
    encryptedBytes: fixture.stagedBlob.encryptedBytes,
    expectedDocumentId: fixture.writerProjection.documentId,
    expectedSlotId: fixture.attachment.slotId,
    resolveProjectionUserKey: fixture.resolveProjectionUserKey,
    writerProjection: fixture.writerProjection,
  };
  const decrypted = await blobs.decryptDocumentAttachmentBlob(decryptInput);

  expect(Array.from(decrypted)).toEqual(Array.from(fixture.bytes));
  // Deliberately corrupt the runtime envelope without a compatibility adapter.
  const legacyBinding = structuredClone(advancedBinding);
  Reflect.deleteProperty(legacyBinding, "writeAuthorization");
  await expect(
    blobs.decryptDocumentAttachmentBlob({
      ...decryptInput,
      binding: legacyBinding,
    }),
  ).rejects.toThrow("lacks blob KEK verification material");
});

test("decryptDocumentAttachmentBlob accepts a binding created after the blob write", async () => {
  const fixture = await createUploadedAttachmentFixture();
  const bindingId = "550e8400-e29b-41d4-a716-446655440563";
  const slotId = "preview-rebound";
  const multipart = createMultipartBlobStageFixture();
  const rebound = await createBlobAttachmentServiceFixture({
    api: {
      ...multipart,
      bindBlobAttachment: async (_blobId, request) =>
        createBlobAttachmentBindResponse({
          blobId: fixture.blobId,
          documentManifest: fixture.writerProjection.documentManifest,
          request,
        }),
      getDocumentWriterProjection: async () => fixture.writerProjection,
    },
    encapsulationSecretKey: fixture.secretKey,
    execSql: fixture.execSql,
  }).uploadDocumentAttachment({
    author: fixture.author,
    bindingId,
    blobId: fixture.blobId,
    bytes: fixture.bytes,
    contentKey: fixture.contentKey,
    documentId: fixture.writerProjection.documentId,
    expectedBindingId: null,
    resolveProjectionUserKey: fixture.resolveProjectionUserKey,
    signedAt: "2026-04-27T00:01:00.000Z",
    slotId,
  });
  if (!rebound) {
    throw new Error("Expected rebound attachment fixture");
  }
  // The rebind keeps the blob's original write header and authorization.
  const original = createFixtureBinding(fixture);
  const binding = {
    ...stagedBindingSummary({
      request: {
        ...rebound.request,
        stagedBlob: { stageId: "rebind", writeHeader: original.writeHeader },
      },
      response: rebound.response,
    }),
    writeAuthorization: original.writeAuthorization,
  };

  const decrypted = await createBlobAttachmentServiceFixture({
    api: {},
    encapsulationSecretKey: fixture.secretKey,
    execSql: fixture.execSql,
  }).decryptDocumentAttachmentBlob({
    binding,
    encryptedBytes: fixture.stagedBlob.encryptedBytes,
    expectedDocumentId: fixture.writerProjection.documentId,
    expectedSlotId: slotId,
    resolveProjectionUserKey: fixture.resolveProjectionUserKey,
    writerProjection: fixture.writerProjection,
  });

  expect(Array.from(decrypted)).toEqual(Array.from(fixture.bytes));
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
    createBlobAttachmentServiceFixture({
      api: {},
      encapsulationSecretKey: fixture.secretKey,
      execSql: fixture.execSql,
    }).decryptDocumentAttachmentBlob({
      binding: createFixtureBinding(fixture),
      encryptedBytes: fixture.stagedBlob.encryptedBytes,
      expectedDocumentId: fixture.writerProjection.documentId,
      expectedSlotId: fixture.attachment.slotId,
      resolveProjectionUserKey: fixture.resolveProjectionUserKey,
      writerProjection: tamperedProjection,
    }),
  ).rejects.toMatchObject({ code: "signature_mismatch" });
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
    createBlobAttachmentServiceFixture({
      api: {},
      encapsulationSecretKey: fixture.secretKey,
      execSql: fixture.execSql,
    }).decryptDocumentAttachmentBlob({
      binding: { ...binding, writeHeader: { ...writeHeader } },
      encryptedBytes: fixture.stagedBlob.encryptedBytes,
      expectedDocumentId: fixture.writerProjection.documentId,
      expectedSlotId: fixture.attachment.slotId,
      resolveProjectionUserKey: async (userId) =>
        userId === writerUserId
          ? createTestTrustedUserIdentity({
              encapsulationPublicKey: kem.publicKey,
              signingKeyFingerprint: writerKeyFingerprint,
              signingPublicKey: signing.signingPublicKey,
              userId,
            })
          : fixture.resolveProjectionUserKey(userId),
      writerProjection: fixture.writerProjection,
    }),
  ).rejects.toThrow("lacks write access through a committed blob target");
});

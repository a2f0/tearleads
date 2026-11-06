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
  createFixtureBinding,
  createUploadedAttachmentFixture,
  stagedBindingSummary,
} from "../../../../test/helpers/blobHydration";
import {
  createBlobAttachmentBindResponse,
  createMultipartBlobStageFixture,
} from "../../../../test/helpers/blobUploadFixtures";
import { createTestTrustedUserIdentity } from "../../../../test/helpers/trustedUserIdentity";
import { readWriteHeader } from "../../../data/documents/shared/readers";
import { uploadDocumentAttachment } from "../upload";
import { decryptDocumentAttachmentBlob } from "./decrypt";

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
  // Deliberately corrupt the runtime envelope without a compatibility adapter.
  const legacyBinding = structuredClone(advancedBinding);
  Reflect.deleteProperty(legacyBinding, "writeAuthorization");
  await expect(
    decryptDocumentAttachmentBlob({
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

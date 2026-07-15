import { expect, test } from "bun:test";
import { toFingerprint } from "../fingerprint";
import { generateSigningSeedAndKeyPair } from "../signing/generateKeyPair";
import { fixtureContainerKekMaterialId } from "./containerKekMaterial.testFixtures";
import {
  CONTENT_RECORD_ENCRYPTION_SUITE,
  computeContentRecordNonceDomainHash,
  computeWriteHeaderHash,
  signWriteHeader,
  verifyWriteHeader,
} from "./index";
import {
  createContainerManifestFixture,
  createDocumentLinkSetManifestFixture,
  createVerifiedContainerKekStateFixture,
  createVerifiedDocumentAccessEvent,
  createWriteHeaderFixture,
  deriveRequiredDocumentKekTargets,
  expectVerificationError,
  fixtureHash,
} from "./testFixtures";

test("write headers are signed, hashed, and verified against expected targets", async () => {
  const signing = generateSigningSeedAndKeyPair();
  const accessManifestHash = await fixtureHash("write-access-manifest");
  const targetHash = await fixtureHash("write-targets");
  const organizationId = "organization-1";
  const contentRecordId = "11111111-1111-4111-8111-111111111111";
  const nonceDomainHash = await computeContentRecordNonceDomainHash({
    version: 1,
    organizationId,
    objectKind: "document",
    objectId: "document-1",
    contentKeyEpoch: 1,
    encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
    contentRecordId,
  });
  const header = await signWriteHeader(
    {
      version: 1,
      organizationId,
      objectKind: "document",
      objectId: "document-1",
      accessManifestHash,
      contentKeyEpoch: 1,
      targetHash,
      encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
      contentRecordId,
      nonceDomainHash,
      metadataHash: await fixtureHash("metadata"),
      ciphertextHash: await fixtureHash("ciphertext"),
      writerUserId: "user-1",
      writerDeviceId: "device-1",
      writerKeyFingerprint: await toFingerprint(signing.signingPublicKey),
      signedAt: "2026-04-25T12:00:00.000Z",
    },
    signing.signingPrivateKey,
  );

  const verified = await verifyWriteHeader({
    header,
    writerPublicKey: signing.signingPublicKey,
    expectedObject: {
      objectKind: "document",
      objectId: "document-1",
      organizationId,
    },
    expectedAccessManifestHash: accessManifestHash,
    expectedTargetHash: targetHash,
  });
  expect(verified.ok).toBe(true);
  if (verified.ok) {
    expect(verified.value.headerHash).toBe(
      await computeWriteHeaderHash(header),
    );
    expect(verified.value.nonceDomainHash).toBe(nonceDomainHash);
    expect(verified.value.nonceDomain.contentRecordId).toBe(contentRecordId);
  }

  const staleTarget = await verifyWriteHeader({
    header,
    writerPublicKey: signing.signingPublicKey,
    expectedTargetHash: await fixtureHash("stale-target"),
  });
  expectVerificationError(staleTarget, "hash_mismatch");

  const secondNonceDomainHash = await computeContentRecordNonceDomainHash({
    version: 1,
    organizationId,
    objectKind: "document",
    objectId: "document-1",
    contentKeyEpoch: 1,
    encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
    contentRecordId: "22222222-2222-4222-8222-222222222222",
  });
  expect(secondNonceDomainHash).not.toBe(nonceDomainHash);

  const badNonceDomain = await verifyWriteHeader({
    header: {
      ...header,
      nonceDomainHash: await fixtureHash("wrong-nonce-domain"),
    },
    writerPublicKey: signing.signingPublicKey,
  });
  expectVerificationError(badNonceDomain, "hash_mismatch");
});

test("write headers prove document write access through committed targets", async () => {
  const writerSigning = generateSigningSeedAndKeyPair();
  const readerSigning = generateSigningSeedAndKeyPair();
  const writerUserId = "writer-user";
  const readerUserId = "reader-user";
  const organizationId = "organization-write-proof";
  const documentId = "document-write-proof";
  const container = await createContainerManifestFixture({
    containerId: "container-write-proof",
    containerKeyEpochId: await fixtureContainerKekMaterialId(
      "container-write-proof-key-1",
    ),
    directGrants: [
      {
        subjectType: "user",
        subjectId: writerUserId,
        accessLevel: "write",
      },
      {
        subjectType: "user",
        subjectId: readerUserId,
        accessLevel: "read",
      },
    ],
    organizationId,
  });
  const documentEvent = await createVerifiedDocumentAccessEvent({
    body: {
      eventType: "document.link",
      containerId: container.state.containerId,
      containerManifestHash: container.manifestHash,
    },
    dependencyManifestHashes: [container.manifestHash],
    objectId: documentId,
    organizationId,
    previousManifestHash: null,
    signer: writerSigning,
    signerUserId: writerUserId,
  });
  const documentManifest = await createDocumentLinkSetManifestFixture({
    documentId,
    event: documentEvent,
    linkedContainerIds: [container.state.containerId],
    organizationId,
  });
  const documentKekTargets = await deriveRequiredDocumentKekTargets({
    containerKekStates: [
      await createVerifiedContainerKekStateFixture({
        manifest: container,
        recipientUserId: writerUserId,
        recipientUserIds: [writerUserId, readerUserId],
      }),
    ],
    documentManifest,
    linkedContainerManifests: [container],
  });
  const writerHeader = await createWriteHeaderFixture({
    accessManifestHash: documentManifest.manifestHash,
    objectId: documentId,
    organizationId,
    signing: writerSigning,
    targetHash: documentKekTargets.documentKeyTargetHash,
    writerUserId,
  });

  const verifiedWriter = await verifyWriteHeader({
    documentAuthorization: {
      authorizingContainerPaths: [[container]],
      documentKekTargets,
      documentManifest,
    },
    header: writerHeader,
    writerPublicKey: writerSigning.signingPublicKey,
  });
  expect(verifiedWriter.ok).toBe(true);

  const readerHeader = await createWriteHeaderFixture({
    accessManifestHash: documentManifest.manifestHash,
    contentRecordId: "22222222-2222-4222-8222-222222222222",
    objectId: documentId,
    organizationId,
    signing: readerSigning,
    targetHash: documentKekTargets.documentKeyTargetHash,
    writerUserId: readerUserId,
  });

  expectVerificationError(
    await verifyWriteHeader({
      documentAuthorization: {
        authorizingContainerPaths: [[container]],
        documentKekTargets,
        documentManifest,
      },
      header: readerHeader,
      writerPublicKey: readerSigning.signingPublicKey,
    }),
    "unauthorized",
  );
});

import { expect, test } from "bun:test";
import { toFingerprint } from "../fingerprint";
import { generateSigningSeedAndKeyPair } from "../signing/generateKeyPair";
import {
  CONTENT_RECORD_ENCRYPTION_SUITE,
  computeBlobAccessManifestHash,
  computeContentRecordNonceDomainHash,
  computeDocumentContentKeyTargetHash,
  computeWriteHeaderHash,
  signWriteHeader,
  verifyWriteHeader,
} from "./index";
import {
  createContainerManifestFixture,
  createDocumentLinkSetManifestFixture,
  createVerifiedAttachmentBinding,
  createVerifiedContainerKekStateFixture,
  createVerifiedDocumentAccessEvent,
  createWriteHeaderFixture,
  deriveRequiredBlobKekTargets,
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
    containerKeyEpochId: "container-write-proof-key-1",
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

test("write headers prove blob write access through derived attachment targets", async () => {
  const writerSigning = generateSigningSeedAndKeyPair();
  const readerSigning = generateSigningSeedAndKeyPair();
  const writerUserId = "blob-writer-user";
  const readerUserId = "blob-reader-user";
  const organizationId = "blob-write-organization";
  const blobId = "blob-write-proof";
  const documentId = "blob-write-document";
  const container = await createContainerManifestFixture({
    containerId: "blob-write-container",
    containerKeyEpochId: "blob-write-container-key-1",
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
  const binding = await createVerifiedAttachmentBinding({
    bindingId: "blob-write-binding",
    blobId,
    documentManifest,
    signer: writerSigning,
    signerUserId: writerUserId,
    slotId: "slot-a",
    writePath: [container],
  });
  const containerKekState = await createVerifiedContainerKekStateFixture({
    manifest: container,
    recipientUserId: writerUserId,
    recipientUserIds: [writerUserId, readerUserId],
  });
  const blobKekTargets = await deriveRequiredBlobKekTargets({
    activeBindings: [binding],
    blobId,
    containerKekStates: [containerKekState],
    documentManifests: [documentManifest],
    linkedContainerManifests: [container],
  });
  expect(blobKekTargets.blobAccessManifestHash).toBe(
    await computeBlobAccessManifestHash({
      version: 1,
      blobId,
      organizationId,
      activeBindingIds: [binding.bindingId],
      documentManifestHashes: [documentManifest.manifestHash],
      linkedContainerManifestHashes: [container.manifestHash],
      linkedContainerKeyEpochIds: [containerKekState.containerKeyEpochId],
      blobKeyTargetHash: blobKekTargets.blobKeyTargetHash,
    }),
  );

  const writerHeader = await createWriteHeaderFixture({
    accessManifestHash: blobKekTargets.blobAccessManifestHash,
    objectId: blobId,
    objectKind: "blob",
    organizationId,
    signing: writerSigning,
    targetHash: blobKekTargets.blobKeyTargetHash,
    writerUserId,
  });
  const verifiedWriter = await verifyWriteHeader({
    blobAuthorization: {
      authorizingContainerPaths: [[container]],
      blobKekTargets,
    },
    header: writerHeader,
    writerPublicKey: writerSigning.signingPublicKey,
  });
  expect(verifiedWriter.ok).toBe(true);

  const readerHeader = await createWriteHeaderFixture({
    accessManifestHash: blobKekTargets.blobAccessManifestHash,
    contentRecordId: "22222222-2222-4222-8222-222222222222",
    objectId: blobId,
    objectKind: "blob",
    organizationId,
    signing: readerSigning,
    targetHash: blobKekTargets.blobKeyTargetHash,
    writerUserId: readerUserId,
  });
  expectVerificationError(
    await verifyWriteHeader({
      blobAuthorization: {
        authorizingContainerPaths: [[container]],
        blobKekTargets,
      },
      header: readerHeader,
      writerPublicKey: readerSigning.signingPublicKey,
    }),
    "unauthorized",
  );

  const staleHeader = await createWriteHeaderFixture({
    accessManifestHash: blobKekTargets.blobAccessManifestHash,
    contentRecordId: "33333333-3333-4333-8333-333333333333",
    objectId: blobId,
    objectKind: "blob",
    organizationId,
    signing: writerSigning,
    targetHash: await fixtureHash("blob-stale-target"),
    writerUserId,
  });
  expectVerificationError(
    await verifyWriteHeader({
      blobAuthorization: {
        authorizingContainerPaths: [[container]],
        blobKekTargets,
      },
      header: staleHeader,
      writerPublicKey: writerSigning.signingPublicKey,
    }),
    "hash_mismatch",
  );
});

test("write header authorization covers every linked container target and historical state", async () => {
  const writerSigning = generateSigningSeedAndKeyPair();
  const writerUserId = "writer-multi-link";
  const organizationId = "organization-multi-link";
  const documentId = "document-multi-link";
  const writeContainer = await createContainerManifestFixture({
    containerId: "container-multi-write",
    containerKeyEpochId: "container-multi-write-key-1",
    directGrants: [
      {
        subjectType: "user",
        subjectId: writerUserId,
        accessLevel: "write",
      },
    ],
    organizationId,
  });
  const readContainer = await createContainerManifestFixture({
    containerId: "container-multi-read",
    containerKeyEpochId: "container-multi-read-key-1",
    directGrants: [
      {
        subjectType: "user",
        subjectId: writerUserId,
        accessLevel: "read",
      },
    ],
    organizationId,
  });
  const documentEvent = await createVerifiedDocumentAccessEvent({
    body: {
      eventType: "document.link",
      containerId: writeContainer.state.containerId,
      containerManifestHash: writeContainer.manifestHash,
    },
    dependencyManifestHashes: [writeContainer.manifestHash],
    objectId: documentId,
    organizationId,
    previousManifestHash: null,
    signer: writerSigning,
    signerUserId: writerUserId,
  });
  const documentManifest = await createDocumentLinkSetManifestFixture({
    documentId,
    event: documentEvent,
    linkedContainerIds: [
      writeContainer.state.containerId,
      readContainer.state.containerId,
    ],
    organizationId,
  });
  const historicalTargets = await deriveRequiredDocumentKekTargets({
    containerKekStates: [
      await createVerifiedContainerKekStateFixture({
        manifest: writeContainer,
        recipientUserId: writerUserId,
      }),
      await createVerifiedContainerKekStateFixture({
        manifest: readContainer,
        recipientUserId: writerUserId,
      }),
    ],
    documentManifest,
    linkedContainerManifests: [writeContainer, readContainer],
  });
  const header = await createWriteHeaderFixture({
    accessManifestHash: documentManifest.manifestHash,
    objectId: documentId,
    organizationId,
    signing: writerSigning,
    targetHash: historicalTargets.documentKeyTargetHash,
    writerUserId,
  });

  const historicalVerification = await verifyWriteHeader({
    documentAuthorization: {
      authorizingContainerPaths: [[writeContainer]],
      documentKekTargets: historicalTargets,
      documentManifest,
    },
    header,
    writerPublicKey: writerSigning.signingPublicKey,
  });
  expect(historicalVerification.ok).toBe(true);

  const firstHistoricalTarget = historicalTargets.targets[0];
  if (!firstHistoricalTarget) {
    throw new Error("Expected at least one historical document target");
  }
  const partialTargetHash = await computeDocumentContentKeyTargetHash([
    firstHistoricalTarget,
  ]);
  const partialHeader = await createWriteHeaderFixture({
    accessManifestHash: documentManifest.manifestHash,
    contentRecordId: "33333333-3333-4333-8333-333333333333",
    objectId: documentId,
    organizationId,
    signing: writerSigning,
    targetHash: partialTargetHash,
    writerUserId,
  });
  expectVerificationError(
    await verifyWriteHeader({
      documentAuthorization: {
        authorizingContainerPaths: [[writeContainer]],
        documentKekTargets: historicalTargets,
        documentManifest,
      },
      header: partialHeader,
      writerPublicKey: writerSigning.signingPublicKey,
    }),
    "hash_mismatch",
  );

  const laterWriteContainer = await createContainerManifestFixture({
    containerId: writeContainer.state.containerId,
    containerKeyEpochId: "container-multi-write-key-2",
    directGrants: [
      {
        subjectType: "user",
        subjectId: writerUserId,
        accessLevel: "read",
      },
    ],
    epoch: 2,
    organizationId,
    previousManifestHash: writeContainer.manifestHash,
  });
  const laterTargets = await deriveRequiredDocumentKekTargets({
    containerKekStates: [
      await createVerifiedContainerKekStateFixture({
        manifest: laterWriteContainer,
        recipientUserId: writerUserId,
      }),
      await createVerifiedContainerKekStateFixture({
        manifest: readContainer,
        recipientUserId: writerUserId,
      }),
    ],
    documentManifest,
    linkedContainerManifests: [laterWriteContainer, readContainer],
  });
  expectVerificationError(
    await verifyWriteHeader({
      documentAuthorization: {
        authorizingContainerPaths: [[laterWriteContainer]],
        documentKekTargets: laterTargets,
        documentManifest,
      },
      header,
      writerPublicKey: writerSigning.signingPublicKey,
    }),
    "hash_mismatch",
  );
});

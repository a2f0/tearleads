import { expect, test } from "bun:test";
import { generateSigningSeedAndKeyPair } from "../signing/generateKeyPair";
import type {
  AttachmentBindAccessEventBody,
  AttachmentDetachAccessEventBody,
  DocumentAccessEventBody,
  KeyingCanonicalJson,
} from "./index";
import {
  verifyAttachmentBindingEvent,
  verifyAttachmentDetachEvent,
  verifyDocumentLinkSetManifest,
} from "./index";
import {
  createContainerManifestFixture,
  createDocumentLinkSetManifestFixture,
  createSignedAttachmentEvent,
  createVerifiedDocumentAccessEvent,
  expectVerificationError,
} from "./testFixtures";

test("verifyDocumentLinkSetManifest advances signed link and unlink heads", async () => {
  const writerUserId = "writer-user";
  const writerSigning = generateSigningSeedAndKeyPair();
  const firstContainer = await createContainerManifestFixture({
    containerId: "container-a",
    containerKeyEpochId: "container-a-key-epoch-1",
    directGrants: [
      {
        subjectType: "user",
        subjectId: writerUserId,
        accessLevel: "write",
      },
    ],
    signer: writerSigning,
    signerUserId: writerUserId,
  });
  const secondContainer = await createContainerManifestFixture({
    containerId: "container-b",
    containerKeyEpochId: "container-b-key-epoch-1",
    directGrants: [
      {
        subjectType: "user",
        subjectId: writerUserId,
        accessLevel: "write",
      },
    ],
    signer: writerSigning,
    signerUserId: writerUserId,
  });
  const documentId = "document-1";
  const initialBody: DocumentAccessEventBody = {
    eventType: "document.link",
    containerId: firstContainer.state.containerId,
    containerManifestHash: firstContainer.manifestHash,
  };
  const initialEvent = await createVerifiedDocumentAccessEvent({
    body: initialBody,
    dependencyManifestHashes: [firstContainer.manifestHash],
    objectId: documentId,
    organizationId: firstContainer.state.organizationId,
    previousManifestHash: null,
    signer: writerSigning,
    signerUserId: writerUserId,
  });
  const initialManifest = await createDocumentLinkSetManifestFixture({
    documentId,
    event: initialEvent,
    linkedContainerIds: [firstContainer.state.containerId],
    organizationId: firstContainer.state.organizationId,
  });
  const initialResult = await verifyDocumentLinkSetManifest({
    manifest: initialManifest.manifest,
    expectedManifestHash: initialManifest.manifestHash,
    event: initialEvent,
    targetContainerPath: [firstContainer],
  });

  expect(initialResult.ok).toBe(true);
  if (!initialResult.ok) {
    throw initialResult.error;
  }

  const linkBody: DocumentAccessEventBody = {
    eventType: "document.link",
    containerId: secondContainer.state.containerId,
    containerManifestHash: secondContainer.manifestHash,
  };
  const linkEvent = await createVerifiedDocumentAccessEvent({
    body: linkBody,
    dependencyManifestHashes: [
      firstContainer.manifestHash,
      secondContainer.manifestHash,
    ],
    objectId: documentId,
    organizationId: firstContainer.state.organizationId,
    previousManifestHash: initialResult.value.manifestHash,
    signer: writerSigning,
    signerUserId: writerUserId,
  });
  const linkedManifest = await createDocumentLinkSetManifestFixture({
    documentId,
    event: linkEvent,
    linkedContainerIds: [
      firstContainer.state.containerId,
      secondContainer.state.containerId,
    ],
    organizationId: firstContainer.state.organizationId,
    previousManifestHash: initialResult.value.manifestHash,
    epoch: 2,
  });
  const linkResult = await verifyDocumentLinkSetManifest({
    manifest: linkedManifest.manifest,
    expectedManifestHash: linkedManifest.manifestHash,
    event: linkEvent,
    previousManifest: initialResult.value,
    authorizingContainerPaths: [[firstContainer]],
    targetContainerPath: [secondContainer],
  });

  expect(linkResult.ok).toBe(true);
  if (!linkResult.ok) {
    throw linkResult.error;
  }
  expect(linkResult.value.state.linkedContainerIds).toEqual([
    firstContainer.state.containerId,
    secondContainer.state.containerId,
  ]);

  const unlinkBody: DocumentAccessEventBody = {
    eventType: "document.unlink",
    containerId: secondContainer.state.containerId,
    containerManifestHash: secondContainer.manifestHash,
  };
  const unlinkEvent = await createVerifiedDocumentAccessEvent({
    body: unlinkBody,
    dependencyManifestHashes: [
      firstContainer.manifestHash,
      secondContainer.manifestHash,
    ],
    objectId: documentId,
    organizationId: firstContainer.state.organizationId,
    previousManifestHash: linkResult.value.manifestHash,
    signer: writerSigning,
    signerUserId: writerUserId,
  });
  const unlinkedManifest = await createDocumentLinkSetManifestFixture({
    documentId,
    event: unlinkEvent,
    linkedContainerIds: [firstContainer.state.containerId],
    organizationId: firstContainer.state.organizationId,
    previousManifestHash: linkResult.value.manifestHash,
    epoch: 3,
  });
  const unlinkResult = await verifyDocumentLinkSetManifest({
    manifest: unlinkedManifest.manifest,
    expectedManifestHash: unlinkedManifest.manifestHash,
    event: unlinkEvent,
    previousManifest: linkResult.value,
    authorizingContainerPaths: [[firstContainer]],
    targetContainerPath: [secondContainer],
  });

  expect(unlinkResult.ok).toBe(true);
  if (!unlinkResult.ok) {
    throw unlinkResult.error;
  }
  expect(unlinkResult.value.state.linkedContainerIds).toEqual([
    firstContainer.state.containerId,
  ]);
});

test("verifyDocumentLinkSetManifest rejects forged linked containers", async () => {
  const writerUserId = "writer-user";
  const writerSigning = generateSigningSeedAndKeyPair();
  const firstContainer = await createContainerManifestFixture({
    containerId: "container-a",
    containerKeyEpochId: "container-a-key-epoch-1",
    directGrants: [
      {
        subjectType: "user",
        subjectId: writerUserId,
        accessLevel: "write",
      },
    ],
    signer: writerSigning,
    signerUserId: writerUserId,
  });
  const secondContainer = await createContainerManifestFixture({
    containerId: "container-b",
    containerKeyEpochId: "container-b-key-epoch-1",
    directGrants: [
      {
        subjectType: "user",
        subjectId: writerUserId,
        accessLevel: "write",
      },
    ],
    signer: writerSigning,
    signerUserId: writerUserId,
  });
  const initialBody: DocumentAccessEventBody = {
    eventType: "document.link",
    containerId: firstContainer.state.containerId,
    containerManifestHash: firstContainer.manifestHash,
  };
  const initialEvent = await createVerifiedDocumentAccessEvent({
    body: initialBody,
    dependencyManifestHashes: [firstContainer.manifestHash],
    objectId: "document-1",
    organizationId: firstContainer.state.organizationId,
    previousManifestHash: null,
    signer: writerSigning,
    signerUserId: writerUserId,
  });
  const forgedManifest = await createDocumentLinkSetManifestFixture({
    documentId: "document-1",
    event: initialEvent,
    linkedContainerIds: [
      firstContainer.state.containerId,
      secondContainer.state.containerId,
    ],
    organizationId: firstContainer.state.organizationId,
  });

  const result = await verifyDocumentLinkSetManifest({
    manifest: forgedManifest.manifest,
    expectedManifestHash: forgedManifest.manifestHash,
    event: initialEvent,
    targetContainerPath: [firstContainer],
  });

  expectVerificationError(result, "hash_mismatch");
});

test("attachment binding events prove signed document write authority", async () => {
  const writerUserId = "writer-user";
  const writerSigning = generateSigningSeedAndKeyPair();
  const container = await createContainerManifestFixture({
    containerId: "attachment-container",
    containerKeyEpochId: "attachment-container-key-epoch-1",
    directGrants: [
      {
        subjectType: "user",
        subjectId: writerUserId,
        accessLevel: "write",
      },
    ],
    signer: writerSigning,
    signerUserId: writerUserId,
  });
  const documentEvent = await createVerifiedDocumentAccessEvent({
    body: {
      eventType: "document.link",
      containerId: container.state.containerId,
      containerManifestHash: container.manifestHash,
    },
    dependencyManifestHashes: [container.manifestHash],
    objectId: "attachment-document",
    organizationId: container.state.organizationId,
    previousManifestHash: null,
    signer: writerSigning,
    signerUserId: writerUserId,
  });
  const documentManifest = await createDocumentLinkSetManifestFixture({
    documentId: "attachment-document",
    event: documentEvent,
    linkedContainerIds: [container.state.containerId],
    organizationId: container.state.organizationId,
  });
  const bindBody: AttachmentBindAccessEventBody = {
    eventType: "attachment.bind",
    bindingId: "binding-1",
    blobId: "blob-1",
    documentId: documentManifest.state.documentId,
    slotId: "slot-1",
    expectedBindingId: null,
    documentManifestHash: documentManifest.manifestHash,
  };
  const bindEvent = await createSignedAttachmentEvent({
    body: bindBody,
    dependencyManifestHashes: [
      documentManifest.manifestHash,
      container.manifestHash,
    ],
    objectId: bindBody.blobId,
    organizationId: documentManifest.state.organizationId,
    signer: writerSigning,
    signerUserId: writerUserId,
  });

  const bindResult = await verifyAttachmentBindingEvent({
    body: bindBody as unknown as KeyingCanonicalJson,
    event: bindEvent,
    signerPublicKey: writerSigning.signingPublicKey,
    documentManifest,
    authorizingContainerPaths: [[container]],
  });
  expect(bindResult.ok).toBe(true);
  if (!bindResult.ok) {
    throw bindResult.error;
  }
  expect(bindResult.value).toMatchObject({
    bindingId: "binding-1",
    blobId: "blob-1",
    documentId: "attachment-document",
    documentManifestHash: documentManifest.manifestHash,
  });

  const missingAuthorityResult = await verifyAttachmentBindingEvent({
    body: bindBody as unknown as KeyingCanonicalJson,
    event: bindEvent,
    signerPublicKey: writerSigning.signingPublicKey,
    documentManifest,
    authorizingContainerPaths: [],
  });
  expectVerificationError(missingAuthorityResult, "unauthorized");

  const detachBody: AttachmentDetachAccessEventBody = {
    eventType: "attachment.detach",
    bindingId: bindBody.bindingId,
    blobId: bindBody.blobId,
    documentId: bindBody.documentId,
    slotId: bindBody.slotId,
    documentManifestHash: documentManifest.manifestHash,
  };
  const detachEvent = await createSignedAttachmentEvent({
    body: detachBody,
    dependencyManifestHashes: [
      documentManifest.manifestHash,
      container.manifestHash,
    ],
    objectId: detachBody.blobId,
    organizationId: documentManifest.state.organizationId,
    signer: writerSigning,
    signerUserId: writerUserId,
  });
  const detachResult = await verifyAttachmentDetachEvent({
    body: detachBody as unknown as KeyingCanonicalJson,
    event: detachEvent,
    signerPublicKey: writerSigning.signingPublicKey,
    documentManifest,
    authorizingContainerPaths: [[container]],
  });

  expect(detachResult.ok).toBe(true);
});

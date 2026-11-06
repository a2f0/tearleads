import { expect, test } from "bun:test";
import { generateSigningSeedAndKeyPair } from "../signing/generateKeyPair";
import { createVerifiedDocumentAccessEvent } from "./accessEvent.testFixtures";
import { createVerifiedAttachmentBinding } from "./attachmentAccessEvent.testFixtures";
import { fixtureHash } from "./canonical.testFixtures";
import { createContainerManifestFixture } from "./containerAccess.testFixtures";
import { createVerifiedContainerKekStateFixture } from "./containerKek.testFixtures";
import { fixtureContainerKekMaterialId as kekId } from "./containerKekMaterial.testFixtures";
import { createDocumentLinkSetManifestFixture } from "./documentLinkSetManifest.testFixtures";
import type {
  DocumentAccessEventBody,
  VerifiedContainerKekState,
} from "./index";
import {
  computeBlobContentKeyTargetHash,
  computeDocumentContentKeyTargetHash,
  deriveBlobKekTargets,
  deriveDocumentKekTargets,
} from "./index";
import { expectVerificationError } from "./verificationError.testFixtures";

test("deriveDocumentKekTargets resolves every linked container KEK target", async () => {
  const writerUserId = "writer-user";
  const writerSigning = generateSigningSeedAndKeyPair();
  const firstContainer = await createContainerManifestFixture({
    containerId: "container-a",
    containerKeyEpochId: await kekId("container-a-key-epoch-1", "container-a"),
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
    containerKeyEpochId: await kekId("container-b-key-epoch-1", "container-b"),
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
  const body: DocumentAccessEventBody = {
    blobRewraps: [],
    eventType: "document.link",
    containerId: firstContainer.state.containerId,
    containerManifestHash: firstContainer.manifestHash,
  };
  const event = await createVerifiedDocumentAccessEvent({
    body,
    dependencyManifestHashes: [firstContainer.manifestHash],
    objectId: "document-1",
    organizationId: firstContainer.state.organizationId,
    previousManifestHash: null,
    signer: writerSigning,
    signerUserId: writerUserId,
  });
  const documentManifest = await createDocumentLinkSetManifestFixture({
    documentId: "document-1",
    event,
    linkedContainerIds: [
      secondContainer.state.containerId,
      firstContainer.state.containerId,
    ],
    organizationId: firstContainer.state.organizationId,
  });
  const firstKekState = await createVerifiedContainerKekStateFixture({
    manifest: firstContainer,
    recipientUserId: writerUserId,
  });
  const secondKekState = await createVerifiedContainerKekStateFixture({
    manifest: secondContainer,
    recipientUserId: writerUserId,
  });

  const result = await deriveDocumentKekTargets({
    documentManifest,
    linkedContainerManifests: [secondContainer, firstContainer],
    containerKekStates: [secondKekState, firstKekState],
  });

  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw result.error;
  }
  expect(result.value.targets).toEqual([
    {
      containerId: firstContainer.state.containerId,
      containerManifestHash: firstContainer.manifestHash,
      containerKeyEpochId: firstKekState.containerKeyEpochId,
      containerKeyEpoch: firstKekState.containerKeyEpoch,
    },
    {
      containerId: secondContainer.state.containerId,
      containerManifestHash: secondContainer.manifestHash,
      containerKeyEpochId: secondKekState.containerKeyEpochId,
      containerKeyEpoch: secondKekState.containerKeyEpoch,
    },
  ]);
  expect(result.value.documentKeyTargetHash).toBe(
    await computeDocumentContentKeyTargetHash(result.value.targets),
  );

  const missingTargetResult = await deriveDocumentKekTargets({
    documentManifest,
    linkedContainerManifests: [firstContainer],
    containerKekStates: [firstKekState],
  });
  expectVerificationError(missingTargetResult, "missing_dependency");

  const staleKekResult = await deriveDocumentKekTargets({
    documentManifest,
    linkedContainerManifests: [firstContainer, secondContainer],
    containerKekStates: [
      firstKekState,
      {
        ...secondKekState,
        accessManifestHash: await fixtureHash("stale-container-manifest"),
      } as VerifiedContainerKekState,
    ],
  });
  expectVerificationError(staleKekResult, "stale_predecessor");
});

test("deriveBlobKekTargets resolves the union of every active attachment binding", async () => {
  const writerUserId = "writer-user";
  const writerSigning = generateSigningSeedAndKeyPair();
  const firstContainer = await createContainerManifestFixture({
    containerId: "blob-container-a",
    containerKeyEpochId: await kekId(
      "blob-container-a-key-epoch-1",
      "blob-container-a",
    ),
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
    containerId: "blob-container-b",
    containerKeyEpochId: await kekId(
      "blob-container-b-key-epoch-1",
      "blob-container-b",
    ),
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
  const firstDocumentEvent = await createVerifiedDocumentAccessEvent({
    body: {
      blobRewraps: [],
      eventType: "document.link",
      containerId: firstContainer.state.containerId,
      containerManifestHash: firstContainer.manifestHash,
    },
    dependencyManifestHashes: [firstContainer.manifestHash],
    objectId: "blob-document-a",
    organizationId: firstContainer.state.organizationId,
    previousManifestHash: null,
    signer: writerSigning,
    signerUserId: writerUserId,
  });
  const secondDocumentEvent = await createVerifiedDocumentAccessEvent({
    body: {
      blobRewraps: [],
      eventType: "document.link",
      containerId: secondContainer.state.containerId,
      containerManifestHash: secondContainer.manifestHash,
    },
    dependencyManifestHashes: [secondContainer.manifestHash],
    objectId: "blob-document-b",
    organizationId: firstContainer.state.organizationId,
    previousManifestHash: null,
    signer: writerSigning,
    signerUserId: writerUserId,
  });
  const firstDocumentManifest = await createDocumentLinkSetManifestFixture({
    documentId: "blob-document-a",
    event: firstDocumentEvent,
    linkedContainerIds: [
      secondContainer.state.containerId,
      firstContainer.state.containerId,
    ],
    organizationId: firstContainer.state.organizationId,
  });
  const secondDocumentManifest = await createDocumentLinkSetManifestFixture({
    documentId: "blob-document-b",
    event: secondDocumentEvent,
    linkedContainerIds: [secondContainer.state.containerId],
    organizationId: firstContainer.state.organizationId,
  });
  const firstKekState = await createVerifiedContainerKekStateFixture({
    manifest: firstContainer,
    recipientUserId: writerUserId,
  });
  const secondKekState = await createVerifiedContainerKekStateFixture({
    manifest: secondContainer,
    recipientUserId: writerUserId,
  });
  const firstBinding = await createVerifiedAttachmentBinding({
    bindingId: "binding-a",
    blobId: "blob-shared",
    documentManifest: firstDocumentManifest,
    signer: writerSigning,
    signerUserId: writerUserId,
    slotId: "slot-a",
    writePath: [firstContainer],
  });
  const secondBinding = await createVerifiedAttachmentBinding({
    bindingId: "binding-b",
    blobId: "blob-shared",
    documentManifest: secondDocumentManifest,
    signer: writerSigning,
    signerUserId: writerUserId,
    slotId: "slot-b",
    writePath: [secondContainer],
  });

  const result = await deriveBlobKekTargets({
    blobId: "blob-shared",
    activeBindings: [secondBinding, firstBinding],
    documentManifests: [secondDocumentManifest, firstDocumentManifest],
    linkedContainerManifests: [secondContainer, firstContainer],
    containerKekStates: [secondKekState, firstKekState],
  });

  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw result.error;
  }
  expect(result.value.targets).toEqual([
    {
      bindingId: "binding-a",
      documentId: "blob-document-a",
      containerId: firstContainer.state.containerId,
      containerManifestHash: firstContainer.manifestHash,
      containerKeyEpochId: firstKekState.containerKeyEpochId,
      containerKeyEpoch: firstKekState.containerKeyEpoch,
    },
    {
      bindingId: "binding-a",
      documentId: "blob-document-a",
      containerId: secondContainer.state.containerId,
      containerManifestHash: secondContainer.manifestHash,
      containerKeyEpochId: secondKekState.containerKeyEpochId,
      containerKeyEpoch: secondKekState.containerKeyEpoch,
    },
    {
      bindingId: "binding-b",
      documentId: "blob-document-b",
      containerId: secondContainer.state.containerId,
      containerManifestHash: secondContainer.manifestHash,
      containerKeyEpochId: secondKekState.containerKeyEpochId,
      containerKeyEpoch: secondKekState.containerKeyEpoch,
    },
  ]);
  expect(result.value.blobKeyTargetHash).toBe(
    await computeBlobContentKeyTargetHash(result.value.targets),
  );

  const omittedBindingResult = await deriveBlobKekTargets({
    blobId: "blob-shared",
    activeBindings: [firstBinding, secondBinding],
    documentManifests: [firstDocumentManifest],
    linkedContainerManifests: [firstContainer, secondContainer],
    containerKekStates: [firstKekState, secondKekState],
  });
  expectVerificationError(omittedBindingResult, "missing_dependency");

  const wrongBlobResult = await deriveBlobKekTargets({
    blobId: "other-blob",
    activeBindings: [firstBinding],
    documentManifests: [firstDocumentManifest],
    linkedContainerManifests: [firstContainer, secondContainer],
    containerKekStates: [firstKekState, secondKekState],
  });
  expectVerificationError(wrongBlobResult, "object_mismatch");
});

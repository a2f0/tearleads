import { expect, test } from "bun:test";
import { generateSigningSeedAndKeyPair } from "../signing/generateKeyPair";
import { fixtureContainerKekMaterialId as kekId } from "./containerKekMaterial.testFixtures";
import type {
  ContainerUserRecipientKey,
  DocumentAccessEventBody,
  VerifiedContainerKekState,
} from "./index";
import {
  computeBlobContentKeyTargetHash,
  computeDocumentContentKeyTargetHash,
  deriveBlobKekTargets,
  deriveDocumentKekTargets,
  derivePrincipalRecipientKeyEpochId,
  verifyContainerKekState,
} from "./index";
import {
  createContainerKeyEpochFixture,
  createContainerKeyWrap,
  createContainerManifestFixture,
  createDocumentLinkSetManifestFixture,
  createPrincipalPolicyFixture,
  createVerifiedAttachmentBinding,
  createVerifiedContainerKekStateFixture,
  createVerifiedDocumentAccessEvent,
  expectVerificationError,
  fixtureHash,
} from "./testFixtures";

test("deriveDocumentKekTargets resolves every linked container KEK target", async () => {
  const writerUserId = "writer-user";
  const writerSigning = generateSigningSeedAndKeyPair();
  const firstContainer = await createContainerManifestFixture({
    containerId: "container-a",
    containerKeyEpochId: await kekId("container-a-key-epoch-1"),
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
    containerKeyEpochId: await kekId("container-b-key-epoch-1"),
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
    containerKeyEpochId: await kekId("blob-container-a-key-epoch-1"),
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
    containerKeyEpochId: await kekId("blob-container-b-key-epoch-1"),
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

test("verifyContainerKekState derives user, principal, and parent wrap targets", async () => {
  const parentManifest = await createContainerManifestFixture({
    containerId: "parent-container",
    containerKeyEpochId: await kekId("parent-key-epoch-1"),
    directGrants: [
      {
        subjectType: "user",
        subjectId: "parent-user",
        accessLevel: "admin",
      },
    ],
  });
  const parentUserKey: ContainerUserRecipientKey = {
    userId: "parent-user",
    recipientKeyEpochId: "parent-user-key-epoch-1",
    recipientKeyFingerprint: await fixtureHash("parent-user-key"),
  };
  const parentKeyEpoch = await createContainerKeyEpochFixture({
    manifest: parentManifest,
  });
  const parentWrap = await createContainerKeyWrap({
    containerKeyEpochId: parentKeyEpoch.id,
    recipientKind: "user",
    recipientId: parentUserKey.userId,
    recipientKeyEpochId: parentUserKey.recipientKeyEpochId,
    recipientKeyFingerprint: parentUserKey.recipientKeyFingerprint,
    wrapManifestHash: parentManifest.manifestHash,
  });
  const parentKekState = await verifyContainerKekState({
    containerManifest: parentManifest,
    keyEpoch: parentKeyEpoch,
    userRecipientKeys: [parentUserKey],
    wraps: [parentWrap],
  });

  expect(parentKekState.ok).toBe(true);
  if (!parentKekState.ok) {
    throw parentKekState.error;
  }

  const groupHead = {
    principalType: "group" as const,
    principalId: "group-1",
    version: 1,
    keyEpoch: 1,
    stateHash: await fixtureHash("group-state"),
    keyFingerprint: await fixtureHash("group-key"),
  };
  const organizationHead = {
    principalType: "organization" as const,
    principalId: "organization-1",
    version: 1,
    keyEpoch: 1,
    stateHash: await fixtureHash("organization-state"),
    keyFingerprint: await fixtureHash("organization-key"),
  };
  const childManifest = await createContainerManifestFixture({
    containerId: "child-container",
    containerKeyEpochId: await kekId("child-key-epoch-1"),
    directGrants: [
      {
        subjectType: "user",
        subjectId: "alice",
        accessLevel: "read",
      },
      {
        subjectType: "group",
        subjectId: groupHead.principalId,
        accessLevel: "write",
      },
      {
        subjectType: "organization",
        subjectId: organizationHead.principalId,
        accessLevel: "read",
      },
    ],
    parentContainerId: parentManifest.state.containerId,
    parentManifestHash: parentManifest.manifestHash,
    referencedPrincipalHeads: [groupHead, organizationHead],
  });
  const aliceKey: ContainerUserRecipientKey = {
    userId: "alice",
    recipientKeyEpochId: "alice-key-epoch-1",
    recipientKeyFingerprint: await fixtureHash("alice-key"),
  };
  const childKeyEpoch = await createContainerKeyEpochFixture({
    manifest: childManifest,
    parentContainerKeyEpochId: parentKekState.value.containerKeyEpochId,
  });
  const childWraps = [
    await createContainerKeyWrap({
      containerKeyEpochId: childKeyEpoch.id,
      recipientKind: "user",
      recipientId: aliceKey.userId,
      recipientKeyEpochId: aliceKey.recipientKeyEpochId,
      recipientKeyFingerprint: aliceKey.recipientKeyFingerprint,
      wrapManifestHash: childManifest.manifestHash,
    }),
    await createContainerKeyWrap({
      containerKeyEpochId: childKeyEpoch.id,
      recipientKind: "group",
      recipientId: groupHead.principalId,
      recipientKeyEpochId: derivePrincipalRecipientKeyEpochId(groupHead),
      recipientKeyFingerprint: groupHead.keyFingerprint,
      wrapManifestHash: childManifest.manifestHash,
    }),
    await createContainerKeyWrap({
      containerKeyEpochId: childKeyEpoch.id,
      recipientKind: "organization",
      recipientId: organizationHead.principalId,
      recipientKeyEpochId: derivePrincipalRecipientKeyEpochId(organizationHead),
      recipientKeyFingerprint: organizationHead.keyFingerprint,
      wrapManifestHash: childManifest.manifestHash,
    }),
    await createContainerKeyWrap({
      containerKeyEpochId: childKeyEpoch.id,
      recipientKind: "container",
      recipientId: parentKekState.value.containerId,
      recipientKeyEpochId: parentKekState.value.containerKeyEpochId,
      recipientKeyFingerprint: parentKekState.value.keyEpochHash,
      wrapManifestHash: childManifest.manifestHash,
    }),
  ];
  const childKekState = await verifyContainerKekState({
    containerManifest: childManifest,
    keyEpoch: childKeyEpoch,
    parentKekState: parentKekState.value,
    principalPolicies: [
      createPrincipalPolicyFixture(groupHead),
      createPrincipalPolicyFixture(organizationHead),
    ],
    userRecipientKeys: [aliceKey],
    wraps: childWraps,
  });

  expect(childKekState.ok).toBe(true);
  if (childKekState.ok) {
    expect(childKekState.value.recipientTargets).toEqual([
      {
        recipientKind: "container",
        recipientId: parentKekState.value.containerId,
        recipientKeyEpochId: parentKekState.value.containerKeyEpochId,
        recipientKeyFingerprint: parentKekState.value.keyEpochHash,
      },
      {
        recipientKind: "group",
        recipientId: groupHead.principalId,
        recipientKeyEpochId: derivePrincipalRecipientKeyEpochId(groupHead),
        recipientKeyFingerprint: groupHead.keyFingerprint,
      },
      {
        recipientKind: "organization",
        recipientId: organizationHead.principalId,
        recipientKeyEpochId:
          derivePrincipalRecipientKeyEpochId(organizationHead),
        recipientKeyFingerprint: organizationHead.keyFingerprint,
      },
      {
        recipientKind: "user",
        recipientId: aliceKey.userId,
        recipientKeyEpochId: aliceKey.recipientKeyEpochId,
        recipientKeyFingerprint: aliceKey.recipientKeyFingerprint,
      },
    ]);
  }
});

test("verifyContainerKekState rejects forged wrap fingerprints and parent edges", async () => {
  const parentManifest = await createContainerManifestFixture({
    containerId: "parent-container-for-reject",
    containerKeyEpochId: await kekId("reject-parent-key-epoch-1"),
    directGrants: [
      {
        subjectType: "user",
        subjectId: "parent-user",
        accessLevel: "admin",
      },
    ],
  });
  const parentUserKey: ContainerUserRecipientKey = {
    userId: "parent-user",
    recipientKeyEpochId: "parent-user-key-epoch-1",
    recipientKeyFingerprint: await fixtureHash("parent-user-key"),
  };
  const parentKeyEpoch = await createContainerKeyEpochFixture({
    manifest: parentManifest,
  });
  const parentWrap = await createContainerKeyWrap({
    containerKeyEpochId: parentKeyEpoch.id,
    recipientKind: "user",
    recipientId: parentUserKey.userId,
    recipientKeyEpochId: parentUserKey.recipientKeyEpochId,
    recipientKeyFingerprint: parentUserKey.recipientKeyFingerprint,
    wrapManifestHash: parentManifest.manifestHash,
  });
  const parentKekState = await verifyContainerKekState({
    containerManifest: parentManifest,
    keyEpoch: parentKeyEpoch,
    userRecipientKeys: [parentUserKey],
    wraps: [parentWrap],
  });

  if (!parentKekState.ok) {
    throw parentKekState.error;
  }

  const childManifest = await createContainerManifestFixture({
    containerId: "child-container-for-reject",
    containerKeyEpochId: await kekId("reject-child-key-epoch-1"),
    directGrants: [
      {
        subjectType: "user",
        subjectId: "alice",
        accessLevel: "read",
      },
    ],
    parentContainerId: parentManifest.state.containerId,
    parentManifestHash: parentManifest.manifestHash,
  });
  const aliceKey: ContainerUserRecipientKey = {
    userId: "alice",
    recipientKeyEpochId: "alice-key-epoch-1",
    recipientKeyFingerprint: await fixtureHash("alice-key"),
  };
  const childKeyEpoch = await createContainerKeyEpochFixture({
    manifest: childManifest,
    parentContainerKeyEpochId: parentKekState.value.containerKeyEpochId,
  });
  const childWraps = [
    await createContainerKeyWrap({
      containerKeyEpochId: childKeyEpoch.id,
      recipientKind: "user",
      recipientId: aliceKey.userId,
      recipientKeyEpochId: aliceKey.recipientKeyEpochId,
      recipientKeyFingerprint: aliceKey.recipientKeyFingerprint,
      wrapManifestHash: childManifest.manifestHash,
    }),
    await createContainerKeyWrap({
      containerKeyEpochId: childKeyEpoch.id,
      recipientKind: "container",
      recipientId: parentKekState.value.containerId,
      recipientKeyEpochId: parentKekState.value.containerKeyEpochId,
      recipientKeyFingerprint: parentKekState.value.keyEpochHash,
      wrapManifestHash: childManifest.manifestHash,
    }),
  ];
  const [aliceWrap, parentContainerWrap] = childWraps;

  if (!aliceWrap || !parentContainerWrap) {
    throw new Error("Expected child wrap fixtures");
  }

  expectVerificationError(
    await verifyContainerKekState({
      containerManifest: childManifest,
      keyEpoch: childKeyEpoch,
      parentKekState: parentKekState.value,
      userRecipientKeys: [aliceKey],
      wraps: [
        { ...aliceWrap, recipientKeyFingerprint: await fixtureHash("bad") },
        parentContainerWrap,
      ],
    }),
    "hash_mismatch",
  );
  // A child must pin its parent's CURRENT epoch, so no historical parent epoch
  // RECORD is ever served. The historical parent KEY is still reachable through
  // the parent's keyring, which is what lets a descendant pinned to a
  // pre-rotation parent be opened and lazily rekeyed rather than stranded —
  // see `containerKekPath.ts`.
  expectVerificationError(
    await verifyContainerKekState({
      containerManifest: childManifest,
      keyEpoch: {
        ...childKeyEpoch,
        parentContainerKeyEpochId: "wrong-parent-key-epoch",
      },
      parentKekState: parentKekState.value,
      userRecipientKeys: [aliceKey],
      wraps: childWraps,
    }),
    "key_epoch_reuse",
  );
});

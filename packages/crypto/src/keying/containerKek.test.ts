import { expect, test } from "bun:test";
import { fixtureHash } from "./canonical.testFixtures";
import {
  createContainerManifestFixture,
  createPrincipalPolicyFixture,
} from "./containerAccess.testFixtures";
import {
  createContainerKeyEpochFixture,
  createContainerKeyWrap,
} from "./containerKek.testFixtures";
import { fixtureContainerKekMaterialId as kekId } from "./containerKekMaterial.testFixtures";
import { createContainerUserRecipientKey } from "./containerUserRecipientKey.testFixtures";
import {
  derivePrincipalRecipientKeyEpochId,
  verifyContainerKekState,
} from "./index";
import { expectVerificationError } from "./verificationError.testFixtures";

test("verifyContainerKekState derives user, principal, and parent wrap targets", async () => {
  const parentManifest = await createContainerManifestFixture({
    containerId: "parent-container",
    containerKeyEpochId: await kekId("parent-key-epoch-1", "parent-container"),
    directGrants: [
      {
        subjectType: "user",
        subjectId: "parent-user",
        accessLevel: "admin",
      },
    ],
  });
  const parentUserKey = await createContainerUserRecipientKey("parent-user");
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
  const childManifest = await createContainerManifestFixture({
    containerId: "child-container",
    containerKeyEpochId: await kekId("child-key-epoch-1", "child-container"),
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
    ],
    parentContainerId: parentManifest.state.containerId,
    parentManifestHash: parentManifest.manifestHash,
    referencedPrincipalHeads: [groupHead],
  });
  const aliceKey = await createContainerUserRecipientKey("alice");
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
    parentManifestHistory: [parentManifest],
    principalPolicies: [createPrincipalPolicyFixture(groupHead)],
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
    containerKeyEpochId: await kekId(
      "reject-parent-key-epoch-1",
      "parent-container-for-reject",
    ),
    directGrants: [
      {
        subjectType: "user",
        subjectId: "parent-user",
        accessLevel: "admin",
      },
    ],
  });
  const parentUserKey = await createContainerUserRecipientKey("parent-user");
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
    containerKeyEpochId: await kekId(
      "reject-child-key-epoch-1",
      "child-container-for-reject",
    ),
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
  const aliceKey = await createContainerUserRecipientKey("alice");
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
      parentManifestHistory: [parentManifest],
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
      parentManifestHistory: [parentManifest],
      userRecipientKeys: [aliceKey],
      wraps: childWraps,
    }),
    "key_epoch_reuse",
  );
});

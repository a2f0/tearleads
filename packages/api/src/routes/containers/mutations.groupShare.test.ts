import { expect } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { containerSyncTombstones } from "@tearleads/api-shared/schema";
import {
  derivePrincipalRecipientKeyEpochId,
  generateKemSeedAndKeyPair,
} from "@tearleads/crypto";
import { createTestUser } from "@tearleads/test-utils";
import { eq } from "drizzle-orm";
import { userRecipientKey } from "../../../test/helpers/containerGrantMutation";
import {
  asVerifiedContainerManifest,
  buildRekeyRequest,
} from "../../../test/helpers/containerMutationRotations";
import {
  accessManifestFromResponse,
  createChild,
  expectMutationSuccess,
  kekStateFromResponse,
  postMutation,
  registerAndAuthenticate,
  test,
} from "../../../test/helpers/containerMutationRoutes";
import {
  buildGrantRequest,
  buildGroupGrantRequest,
} from "../../../test/helpers/containerShareRequests";
import {
  commitGroupGrant,
  firstCompoundMutation,
  putGroupPrincipalPolicy,
} from "../../../test/helpers/groupPolicyContainerCommits";
import { bootstrapRoot } from "../../../test/helpers/keyingWriterProjectionKit";
import { joinOrg } from "../../../test/helpers/organizationMembership";

test("POST /containers/:containerId/share rejects a group grant absent from its signed index", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await bootstrapRoot(owner);
  const rootManifest = asVerifiedContainerManifest(root.bundle);
  const group = await putGroupPrincipalPolicy({
    actor: owner,
    principalId: crypto.randomUUID(),
  });
  const request = await buildGroupGrantRequest({
    parentKekState: null,
    previous: root.bundle,
    previousContainerPath: [root.bundle],
    previousKekState: root.kekState,
    principalPolicy: group.policy,
    principalReference: group.reference,
    signer: owner,
  });

  const response = await postMutation({
    path: `/containers/${rootManifest.state.containerId}/share`,
    request,
    token: owner.token,
  });

  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    error:
      "Group grant changes require a matching signed principal grant index",
  });
});

test("POST /containers/:containerId/share allows additional root group grants", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);

  const root = await bootstrapRoot(owner);
  const rootManifest = asVerifiedContainerManifest(root.bundle);
  const groupPrincipalId = crypto.randomUUID();
  const group = await putGroupPrincipalPolicy({
    actor: owner,
    principalId: groupPrincipalId,
  });
  const granted = await commitGroupGrant({
    accessLevel: "write",
    actor: owner,
    buildMutation: ({ policy, reference }) =>
      buildGroupGrantRequest({
        accessLevel: "write",
        parentKekState: null,
        previous: root.bundle,
        previousContainerPath: [root.bundle],
        previousKekState: root.kekState,
        principalPolicy: policy,
        principalReference: reference,
        signer: owner,
      }),
    containerId: rootManifest.state.containerId,
    current: group,
  });
  const shared = await firstCompoundMutation(granted);

  const sharedManifest = asVerifiedContainerManifest(
    accessManifestFromResponse(shared),
  );
  expect(shared.manifestHead.epoch).toBe(rootManifest.state.epoch + 1);
  expect(sharedManifest.state.directGrants).toContainEqual({
    accessLevel: "write",
    subjectId: groupPrincipalId,
    subjectType: "group",
  });
  expect(shared.containerKek.recipientTargets).toContainEqual({
    recipientKind: "group",
    recipientId: groupPrincipalId,
    recipientKeyEpochId: derivePrincipalRecipientKeyEpochId(granted.reference),
    recipientKeyFingerprint: granted.reference.keyFingerprint,
  });
});

test("POST /containers/:containerId/share stores group KEK targets and rejects stale group policy", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const directRecipient = createTestUser();
  await registerAndAuthenticate(directRecipient);

  const root = await bootstrapRoot(owner);
  const created = await createChild({
    parent: root.bundle,
    parentKekState: root.kekState,
    signer: owner,
  });
  const createdBundle = accessManifestFromResponse(created);
  const directRecipientKey = await userRecipientKey(directRecipient);
  const userGrantRequest = await buildGrantRequest({
    parentKekState: root.kekState,
    previous: createdBundle,
    previousContainerPath: [root.bundle, createdBundle],
    previousKekState: kekStateFromResponse(created),
    recipient: directRecipient,
    signer: owner,
  });
  const userShared = await expectMutationSuccess(
    await postMutation({
      path: `/containers/${created.containerId}/share`,
      request: userGrantRequest,
      token: owner.token,
    }),
  );
  const userSharedBundle = accessManifestFromResponse(userShared);

  const groupPrincipalId = crypto.randomUUID();
  const initialGroup = await putGroupPrincipalPolicy({
    actor: owner,
    principalId: groupPrincipalId,
  });
  const grantedGroup = await commitGroupGrant({
    actor: owner,
    buildMutation: ({ policy, reference }) =>
      buildGroupGrantRequest({
        containerManifestHistory: [createdBundle, userSharedBundle],
        parentKekState: root.kekState,
        previous: userSharedBundle,
        previousContainerPath: [root.bundle, userSharedBundle],
        previousKekState: kekStateFromResponse(userShared),
        principalPolicy: policy,
        principalReference: reference,
        signer: owner,
        userRecipientKeys: [directRecipientKey],
      }),
    containerId: created.containerId,
    current: initialGroup,
  });
  const shared = await firstCompoundMutation(grantedGroup);

  expect(shared.containerKek.containerKeyEpochId).toBe(
    userShared.containerKek.containerKeyEpochId,
  );
  expect(
    Reflect.get(shared.accessManifest.state, "referencedPrincipalHeads"),
  ).toEqual([
    {
      principalType: "group",
      principalId: groupPrincipalId,
      version: grantedGroup.reference.version,
      keyEpoch: grantedGroup.reference.keyEpoch,
      stateHash: grantedGroup.reference.stateHash,
      keyFingerprint: grantedGroup.reference.keyFingerprint,
    },
  ]);
  expect(shared.containerKek.recipientTargets).toEqual([
    {
      recipientKind: "container",
      recipientId: root.kekState.containerId,
      recipientKeyEpochId: root.kekState.containerKeyEpochId,
      recipientKeyFingerprint: root.kekState.keyEpochHash,
    },
    {
      recipientKind: "group",
      recipientId: groupPrincipalId,
      recipientKeyEpochId: derivePrincipalRecipientKeyEpochId(
        grantedGroup.reference,
      ),
      recipientKeyFingerprint: grantedGroup.reference.keyFingerprint,
    },
    {
      recipientKind: "user",
      recipientId: directRecipient.userId,
      recipientKeyEpochId: directRecipientKey.recipientKeyEpochId,
      recipientKeyFingerprint: directRecipientKey.recipientKeyFingerprint,
    },
  ]);

  const secondGroupPrincipalId = crypto.randomUUID();
  const secondGroup = await putGroupPrincipalPolicy({
    actor: owner,
    principalId: secondGroupPrincipalId,
    signedAt: "2026-04-30T00:00:30.000Z",
  });
  const sharedBundle = accessManifestFromResponse(shared);
  const secondGrantedGroup = await commitGroupGrant({
    actor: owner,
    buildMutation: ({ policy, reference }) =>
      buildGroupGrantRequest({
        containerManifestHistory: [
          createdBundle,
          userSharedBundle,
          sharedBundle,
        ],
        parentKekState: root.kekState,
        previous: sharedBundle,
        previousContainerPath: [root.bundle, sharedBundle],
        previousKekState: kekStateFromResponse(shared),
        principalPolicies: [grantedGroup.policy],
        principalPolicy: policy,
        principalReference: reference,
        signer: owner,
        userRecipientKeys: [directRecipientKey],
      }),
    containerId: created.containerId,
    current: secondGroup,
    signedAt: "2026-04-30T00:00:31.000Z",
  });
  const secondGroupShared = await firstCompoundMutation(secondGrantedGroup);
  expect(secondGroupShared.containerKek.containerKeyEpochId).toBe(
    shared.containerKek.containerKeyEpochId,
  );
  expect(secondGroupShared.containerKek.recipientTargets).toHaveLength(4);
  expect(secondGroupShared.containerKek.recipientTargets).toContainEqual({
    recipientKind: "group",
    recipientId: groupPrincipalId,
    recipientKeyEpochId: derivePrincipalRecipientKeyEpochId(
      grantedGroup.reference,
    ),
    recipientKeyFingerprint: grantedGroup.reference.keyFingerprint,
  });
  expect(secondGroupShared.containerKek.recipientTargets).toContainEqual({
    recipientKind: "group",
    recipientId: secondGroupPrincipalId,
    recipientKeyEpochId: derivePrincipalRecipientKeyEpochId(
      secondGrantedGroup.reference,
    ),
    recipientKeyFingerprint: secondGrantedGroup.reference.keyFingerprint,
  });

  await putGroupPrincipalPolicy({
    actor: owner,
    keyEpoch: grantedGroup.policy.keyEpoch + 1,
    prevStateHash: grantedGroup.stateHash,
    principalId: groupPrincipalId,
    principalKem: generateKemSeedAndKeyPair(),
    prepareContainerMutations: async ({ policy }) => [
      await buildRekeyRequest({
        parentKekState: root.kekState,
        previous: accessManifestFromResponse(secondGroupShared),
        previousContainerPath: [
          root.bundle,
          accessManifestFromResponse(secondGroupShared),
        ],
        previousKekState: kekStateFromResponse(secondGroupShared),
        replacementPrincipalPolicy: policy,
        signer: owner,
      }),
    ],
    signedAt: "2026-04-30T00:01:00.000Z",
    version: grantedGroup.policy.version + 1,
  });
  const secondChild = await createChild({
    parent: root.bundle,
    parentKekState: root.kekState,
    signer: owner,
  });
  const staleGroupGrantRequest = await buildGroupGrantRequest({
    parentKekState: root.kekState,
    previous: accessManifestFromResponse(secondChild),
    previousContainerPath: [
      root.bundle,
      accessManifestFromResponse(secondChild),
    ],
    previousKekState: kekStateFromResponse(secondChild),
    principalPolicy: initialGroup.policy,
    principalReference: initialGroup.reference,
    signer: owner,
  });
  const staleResponse = await postMutation({
    path: `/containers/${secondChild.containerId}/share`,
    request: staleGroupGrantRequest,
    token: owner.token,
  });

  expect(staleResponse.status).toBe(409);
  expect((await staleResponse.json()).error).toBe("Principal policy is stale");
});

test("POST share group grant prunes member tombstones", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const recipient = createTestUser();
  await registerAndAuthenticate(recipient);

  const root = await bootstrapRoot(owner);
  const created = await createChild({
    parent: root.bundle,
    parentKekState: root.kekState,
    signer: owner,
  });
  const childBundle = accessManifestFromResponse(created);
  const childKek = kekStateFromResponse(created);
  await joinOrg(created.organizationId, owner, recipient);
  const groupPrincipalId = crypto.randomUUID();
  const group = await putGroupPrincipalPolicy({
    actor: owner,
    members: [{ userId: owner.userId }, { userId: recipient.userId }],
    principalId: groupPrincipalId,
  });

  // The post-revocation state: the recipient, a current member of the
  // granted group, holds a stale access_revoked tombstone for the child.
  await db.insert(containerSyncTombstones).values({
    containerId: created.containerId,
    depth: 1,
    organizationId: created.organizationId,
    parentId: null,
    reason: "access_revoked",
    updatedAt: new Date("2026-12-31T00:00:00.000Z"),
    userId: recipient.userId,
  });

  await commitGroupGrant({
    accessLevel: "read",
    actor: owner,
    buildMutation: ({ policy, reference }) =>
      buildGroupGrantRequest({
        accessLevel: "read",
        parentKekState: root.kekState,
        previous: childBundle,
        previousContainerPath: [root.bundle, childBundle],
        previousKekState: childKek,
        principalPolicy: policy,
        principalReference: reference,
        signer: owner,
      }),
    containerId: created.containerId,
    current: group,
  });

  const remaining = await db
    .select({ id: containerSyncTombstones.id })
    .from(containerSyncTombstones)
    .where(eq(containerSyncTombstones.userId, recipient.userId));
  expect(remaining).toEqual([]);
});

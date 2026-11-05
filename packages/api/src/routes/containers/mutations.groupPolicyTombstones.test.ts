import { expect } from "bun:test";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import { createTestUser } from "@tearleads/test-utils";
import { userRecipientKey } from "../../../test/helpers/containerGrantMutation";
import { buildRekeyRequest } from "../../../test/helpers/containerMutationRotations";
import {
  accessManifestFromResponse,
  createChild,
  expectMutationSuccess,
  kekStateFromResponse,
  listRootContainers,
  postMutation,
  test,
} from "../../../test/helpers/containerMutationRoutes";
import {
  firstContainerTombstone as firstTombstone,
  requestSingleContainerParentLane as listContainersForUser,
  readContainerParentLanePage as readLanePage,
} from "../../../test/helpers/containerParentLaneQuery";
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
import { registerAndAuthenticate } from "../../../test/helpers/registerUser";

test("PUT /principals/group/:principalId/policy emits tombstones for removed group members", async () => {
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
  const createdBundle = accessManifestFromResponse(created);
  await joinOrg(created.organizationId, owner, recipient);
  const groupPrincipalId = crypto.randomUUID();
  const group = await putGroupPrincipalPolicy({
    actor: owner,
    members: [{ userId: recipient.userId }],
    principalId: groupPrincipalId,
  });
  const grantedGroup = await commitGroupGrant({
    actor: owner,
    buildMutation: ({ policy, reference }) =>
      buildGroupGrantRequest({
        parentKekState: root.kekState,
        previous: createdBundle,
        previousContainerPath: [root.bundle, createdBundle],
        previousKekState: kekStateFromResponse(created),
        principalPolicy: policy,
        principalReference: reference,
        signer: owner,
      }),
    containerId: created.containerId,
    current: group,
  });
  const shared = await firstCompoundMutation(grantedGroup);

  const recipientBaselineResponse = await listRootContainers({
    token: recipient.token,
  });
  expect(recipientBaselineResponse.status).toBe(200);
  const recipientBaseline = await readLanePage(recipientBaselineResponse);
  expect(
    recipientBaseline.items.map((container: { id: string }) => container.id),
  ).toContain(created.containerId);
  expect(recipientBaseline.nextWatermark).toEqual({
    id: created.containerId,
    updatedAt: expect.any(String),
  });

  await putGroupPrincipalPolicy({
    actor: owner,
    keyEpoch: grantedGroup.policy.keyEpoch + 1,
    members: [{ userId: owner.userId }],
    prevStateHash: grantedGroup.stateHash,
    principalId: groupPrincipalId,
    principalKem: generateKemSeedAndKeyPair(),
    prepareContainerMutations: async ({ policy }) => [
      await buildRekeyRequest({
        parentKekState: root.kekState,
        previous: accessManifestFromResponse(shared),
        previousContainerPath: [
          root.bundle,
          accessManifestFromResponse(shared),
        ],
        previousKekState: kekStateFromResponse(shared),
        replacementPrincipalPolicy: policy,
        signer: owner,
      }),
    ],
    signedAt: "2026-04-30T00:02:00.000Z",
    version: grantedGroup.policy.version + 1,
  });

  const recipientDeltaResponse = await listRootContainers({
    token: recipient.token,
    watermark: recipientBaseline.nextWatermark,
  });
  expect(recipientDeltaResponse.status).toBe(200);
  const recipientDelta = await readLanePage(recipientDeltaResponse);
  expect(
    recipientDelta.items.map((container: { id: string }) => container.id),
  ).not.toContain(created.containerId);
  expect(recipientDelta.tombstones).toEqual([
    {
      containerId: created.containerId,
      depth: 1,
      parentId: root.kekState.containerId,
      reason: "access_revoked",
      updatedAt: expect.any(String),
    },
  ]);
  expect(recipientDelta.nextWatermark).toEqual({
    id: created.containerId,
    updatedAt: firstTombstone(recipientDelta).updatedAt,
  });

  const recipientParentLaneResponse = await listContainersForUser({
    parentId: root.kekState.containerId,
    token: recipient.token,
  });
  expect(recipientParentLaneResponse.status).toBe(200);
  expect(
    (await readLanePage(recipientParentLaneResponse)).tombstones,
  ).toContainEqual({
    containerId: created.containerId,
    depth: 1,
    parentId: root.kekState.containerId,
    reason: "access_revoked",
    updatedAt: firstTombstone(recipientDelta).updatedAt,
  });
});

test("PUT /principals/group/:principalId/policy skips tombstones while direct access remains", async () => {
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
  const createdBundle = accessManifestFromResponse(created);
  const directShareRequest = await buildGrantRequest({
    parentKekState: root.kekState,
    previous: createdBundle,
    previousContainerPath: [root.bundle, createdBundle],
    previousKekState: kekStateFromResponse(created),
    recipient,
    signer: owner,
  });
  const directShared = await expectMutationSuccess(
    await postMutation({
      path: `/containers/${created.containerId}/share`,
      request: directShareRequest,
      token: owner.token,
    }),
  );
  const recipientKey = await userRecipientKey(recipient);
  const groupPrincipalId = crypto.randomUUID();
  const group = await putGroupPrincipalPolicy({
    actor: owner,
    members: [{ userId: recipient.userId }],
    principalId: groupPrincipalId,
  });
  const directSharedBundle = accessManifestFromResponse(directShared);
  const grantedGroup = await commitGroupGrant({
    actor: owner,
    buildMutation: ({ policy, reference }) =>
      buildGroupGrantRequest({
        containerManifestHistory: [createdBundle, directSharedBundle],
        parentKekState: root.kekState,
        previous: directSharedBundle,
        previousContainerPath: [root.bundle, directSharedBundle],
        previousKekState: kekStateFromResponse(directShared),
        principalPolicy: policy,
        principalReference: reference,
        signer: owner,
        userRecipientKeys: [recipientKey],
      }),
    containerId: created.containerId,
    current: group,
  });
  const groupShared = await firstCompoundMutation(grantedGroup);

  const recipientBaselineResponse = await listRootContainers({
    token: recipient.token,
  });
  expect(recipientBaselineResponse.status).toBe(200);
  const recipientBaseline = await readLanePage(recipientBaselineResponse);
  expect(
    recipientBaseline.items.map((container: { id: string }) => container.id),
  ).toContain(created.containerId);
  expect(recipientBaseline.nextWatermark).toEqual({
    id: created.containerId,
    updatedAt: expect.any(String),
  });

  await putGroupPrincipalPolicy({
    actor: owner,
    keyEpoch: grantedGroup.policy.keyEpoch + 1,
    members: [{ userId: owner.userId }],
    prevStateHash: grantedGroup.stateHash,
    principalId: groupPrincipalId,
    principalKem: generateKemSeedAndKeyPair(),
    prepareContainerMutations: async ({ policy }) => [
      await buildRekeyRequest({
        parentKekState: root.kekState,
        previous: accessManifestFromResponse(groupShared),
        previousContainerPath: [
          root.bundle,
          accessManifestFromResponse(groupShared),
        ],
        previousKekState: kekStateFromResponse(groupShared),
        replacementPrincipalPolicy: policy,
        signer: owner,
      }),
    ],
    signedAt: "2026-04-30T00:03:00.000Z",
    version: grantedGroup.policy.version + 1,
  });

  const recipientDeltaResponse = await listRootContainers({
    token: recipient.token,
    watermark: recipientBaseline.nextWatermark,
  });
  expect(recipientDeltaResponse.status).toBe(200);
  const recipientDelta = await readLanePage(recipientDeltaResponse);
  expect(recipientDelta.tombstones).toEqual([]);
  expect(
    recipientDelta.items.map((container: { id: string }) => container.id),
  ).toContain(created.containerId);
  expect(recipientDelta.nextWatermark).toEqual({
    id: created.containerId,
    updatedAt: expect.any(String),
  });
  expect(recipientDelta.nextWatermark).not.toEqual(
    recipientBaseline.nextWatermark,
  );
});

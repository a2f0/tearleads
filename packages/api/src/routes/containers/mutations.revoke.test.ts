import { expect } from "bun:test";
import { createTestUser } from "@tearleads/test-utils";
import { buildRevokeRequest } from "../../../test/helpers/containerMutationRotations";
import {
  accessManifestFromResponse,
  createChild,
  expectMutationSuccess,
  kekStateFromResponse,
  listRootContainers,
  postMutation,
  registerAndAuthenticate,
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

test("POST /containers/:containerId/revoke advances the KEK epoch", async () => {
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
  const shareRequest = await buildGrantRequest({
    parentKekState: root.kekState,
    previous: accessManifestFromResponse(created),
    previousContainerPath: [root.bundle, accessManifestFromResponse(created)],
    previousKekState: kekStateFromResponse(created),
    recipient,
    signer: owner,
  });
  const shared = await expectMutationSuccess(
    await postMutation({
      path: `/containers/${created.containerId}/share`,
      request: shareRequest,
      token: owner.token,
    }),
  );
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

  const sharedBundle = accessManifestFromResponse(shared);
  const revokeRequest = await buildRevokeRequest({
    parentKekState: root.kekState,
    previous: sharedBundle,
    previousContainerPath: [root.bundle, sharedBundle],
    previousKekState: kekStateFromResponse(shared),
    revokedUser: recipient,
    signer: owner,
  });

  const revoked = await expectMutationSuccess(
    await postMutation({
      path: `/containers/${created.containerId}/revoke`,
      request: revokeRequest,
      token: owner.token,
    }),
  );

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

  expect(revoked.manifestHead.epoch).toBe(3);
  expect(revoked.containerKek.containerKeyEpoch).toBe(2);
  expect(revoked.containerKek.containerKeyEpochId).not.toBe(
    shared.containerKek.containerKeyEpochId,
  );
  expect(revoked.containerKek.recipientTargets).toEqual([
    {
      recipientKind: "container",
      recipientId: root.kekState.containerId,
      recipientKeyEpochId: root.kekState.containerKeyEpochId,
      recipientKeyFingerprint: root.kekState.keyEpochHash,
    },
  ]);
});

test("group grant revoke requires and commits with principal rotation", async () => {
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

  const sharedBundle = accessManifestFromResponse(shared);
  const revokeRequest = await buildRevokeRequest({
    parentKekState: root.kekState,
    previous: sharedBundle,
    previousContainerPath: [root.bundle, sharedBundle],
    previousKekState: kekStateFromResponse(shared),
    revokedGrant: {
      subjectType: "group",
      subjectId: groupPrincipalId,
    },
    signer: owner,
  });

  const response = await postMutation({
    path: `/containers/${created.containerId}/revoke`,
    request: revokeRequest,
    token: owner.token,
  });

  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    error: "Group grants must be revoked atomically with principal rotation",
  });

  revokeRequest.principalPolicyRefs = revokeRequest.principalPolicyRefs.filter(
    (ref) => ref.principalId !== groupPrincipalId,
  );
  await putGroupPrincipalPolicy({
    actor: owner,
    containerMutations: [revokeRequest],
    grants: [],
    keyEpoch: grantedGroup.policy.keyEpoch + 1,
    members: grantedGroup.policy.projection.map((member) => ({
      userId: member.userId,
    })),
    prevStateHash: grantedGroup.policy.stateHash,
    principalId: groupPrincipalId,
    projection: [...grantedGroup.policy.projection],
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
});

test("POST /containers/:containerId/revoke skips tombstones while access remains inherited", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const recipient = createTestUser();
  await registerAndAuthenticate(recipient);

  const root = await bootstrapRoot(owner);
  const child = await createChild({
    parent: root.bundle,
    parentKekState: root.kekState,
    signer: owner,
  });
  const childShareRequest = await buildGrantRequest({
    parentKekState: root.kekState,
    previous: accessManifestFromResponse(child),
    previousContainerPath: [root.bundle, accessManifestFromResponse(child)],
    previousKekState: kekStateFromResponse(child),
    recipient,
    signer: owner,
  });
  const sharedChild = await expectMutationSuccess(
    await postMutation({
      path: `/containers/${child.containerId}/share`,
      request: childShareRequest,
      token: owner.token,
    }),
  );
  const sharedChildBundle = accessManifestFromResponse(sharedChild);
  const sharedChildKekState = kekStateFromResponse(sharedChild);
  const grandchild = await createChild({
    parent: sharedChildBundle,
    parentContainerPath: [root.bundle, sharedChildBundle],
    parentKekState: sharedChildKekState,
    signer: owner,
  });
  const grandchildShareRequest = await buildGrantRequest({
    parentKekState: sharedChildKekState,
    previous: accessManifestFromResponse(grandchild),
    previousContainerPath: [
      root.bundle,
      sharedChildBundle,
      accessManifestFromResponse(grandchild),
    ],
    previousKekState: kekStateFromResponse(grandchild),
    recipient,
    signer: owner,
  });
  const sharedGrandchild = await expectMutationSuccess(
    await postMutation({
      path: `/containers/${grandchild.containerId}/share`,
      request: grandchildShareRequest,
      token: owner.token,
    }),
  );

  const recipientBaselineResponse = await listRootContainers({
    token: recipient.token,
  });
  expect(recipientBaselineResponse.status).toBe(200);
  const recipientBaseline = await readLanePage(recipientBaselineResponse);
  expect(
    recipientBaseline.items.map((container: { id: string }) => container.id),
  ).toEqual(
    expect.arrayContaining([child.containerId, grandchild.containerId]),
  );
  expect(recipientBaseline.nextWatermark).not.toBeNull();

  const sharedGrandchildBundle = accessManifestFromResponse(sharedGrandchild);
  const revokeRequest = await buildRevokeRequest({
    parentKekState: sharedChildKekState,
    previous: sharedGrandchildBundle,
    previousContainerPath: [
      root.bundle,
      sharedChildBundle,
      sharedGrandchildBundle,
    ],
    previousKekState: kekStateFromResponse(sharedGrandchild),
    revokedUser: recipient,
    signer: owner,
  });

  await expectMutationSuccess(
    await postMutation({
      path: `/containers/${grandchild.containerId}/revoke`,
      request: revokeRequest,
      token: owner.token,
    }),
  );

  const recipientRootDeltaResponse = await listRootContainers({
    token: recipient.token,
    watermark: recipientBaseline.nextWatermark,
  });
  expect(recipientRootDeltaResponse.status).toBe(200);
  const recipientRootDelta = await readLanePage(recipientRootDeltaResponse);
  expect(recipientRootDelta.tombstones).toEqual([]);
  expect(recipientRootDelta.nextWatermark).toEqual(
    recipientBaseline.nextWatermark,
  );

  const recipientChildLaneResponse = await listContainersForUser({
    parentId: child.containerId,
    token: recipient.token,
  });
  expect(recipientChildLaneResponse.status).toBe(200);
  const recipientChildLane = await readLanePage(recipientChildLaneResponse);
  expect(
    recipientChildLane.items.map((container: { id: string }) => container.id),
  ).toContain(grandchild.containerId);
});

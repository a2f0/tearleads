import { expect } from "bun:test";
import {
  derivePrincipalRecipientKeyEpochId,
  generateKemSeedAndKeyPair,
} from "@tearleads/crypto";
import { createTestUser } from "@tearleads/test-utils";
import invariant from "invariant";
import {
  asVerifiedContainerManifest,
  buildRevokeRequest,
} from "../../../test/helpers/containerMutationRotations";
import {
  postMutation,
  registerAndAuthenticate,
  test,
} from "../../../test/helpers/containerMutationRoutes";
import { buildGroupGrantRequest } from "../../../test/helpers/containerShareRequests";
import { putGroupPrincipalPolicy } from "../../../test/helpers/groupPolicyContainerCommits";
import { bootstrapRoot } from "../../../test/helpers/keyingWriterProjectionKit";
import { buildGroupMembershipContainerMutations } from "../../../test/helpers/organizationMembershipGrants";

test("Admins rotation rekeys its built-in grant without changing access", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await bootstrapRoot(owner);
  const rootManifest = asVerifiedContainerManifest(root.bundle);
  const adminGrant = rootManifest.state.directGrants.find(
    (grant) => grant.subjectType === "group" && grant.accessLevel === "admin",
  );
  invariant(adminGrant, "expected root admin group grant");
  const adminPolicy = root.principalPolicies?.find(
    (policy) =>
      policy.principalType === adminGrant.subjectType &&
      policy.principalId === adminGrant.subjectId,
  );
  invariant(adminPolicy, "expected root admin group policy");
  const rotatedAdminGroup = await putGroupPrincipalPolicy({
    actor: owner,
    keyEpoch: adminPolicy.keyEpoch + 1,
    prevStateHash: adminPolicy.stateHash,
    principalId: adminPolicy.principalId,
    principalKem: generateKemSeedAndKeyPair(),
    prepareContainerMutations: ({ policy }) =>
      buildGroupMembershipContainerMutations({
        actor: owner,
        nextPolicy: policy,
      }),
    signedAt: "2026-04-30T00:00:30.000Z",
    version: adminPolicy.version + 1,
  });
  const reshared = await bootstrapRoot(owner);
  const resharedManifest = asVerifiedContainerManifest(reshared.bundle);

  expect(resharedManifest.state.directGrants).toContainEqual(adminGrant);
  expect(resharedManifest.state.referencedPrincipalHeads).toEqual([
    rotatedAdminGroup.reference,
  ]);
  expect(reshared.kekState.containerKeyEpochId).not.toBe(
    root.kekState.containerKeyEpochId,
  );
  expect(reshared.kekState.recipientTargets).toEqual([
    {
      recipientKind: "group",
      recipientId: adminGrant.subjectId,
      recipientKeyEpochId: derivePrincipalRecipientKeyEpochId(
        rotatedAdminGroup.reference,
      ),
      recipientKeyFingerprint: rotatedAdminGroup.reference.keyFingerprint,
    },
  ]);
});

for (const accessLevel of ["read", "write"] as const) {
  test(`POST /containers/:containerId/share rejects changing a built-in admin grant to ${accessLevel}`, async () => {
    const owner = createTestUser();
    await registerAndAuthenticate(owner);
    const root = await bootstrapRoot(owner);
    const rootManifest = asVerifiedContainerManifest(root.bundle);
    const adminGrant = rootManifest.state.directGrants.find(
      (grant) => grant.subjectType === "group" && grant.accessLevel === "admin",
    );
    invariant(adminGrant, "expected root admin group grant");
    const adminReference = rootManifest.state.referencedPrincipalHeads.find(
      (reference) =>
        reference.principalType === adminGrant.subjectType &&
        reference.principalId === adminGrant.subjectId,
    );
    invariant(adminReference, "expected root admin group reference");
    const adminPolicy = root.principalPolicies?.find(
      (policy) =>
        policy.principalType === adminGrant.subjectType &&
        policy.principalId === adminGrant.subjectId,
    );
    invariant(adminPolicy, "expected root admin group policy");
    const request = await buildGroupGrantRequest({
      accessLevel,
      parentKekState: null,
      previous: root.bundle,
      previousContainerPath: [root.bundle],
      previousKekState: root.kekState,
      principalPolicy: adminPolicy,
      principalReference: adminReference,
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
}

test("POST /containers/:containerId/revoke rejects built-in grants", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await bootstrapRoot(owner);
  const rootManifest = asVerifiedContainerManifest(root.bundle);
  const adminGrant = rootManifest.state.directGrants.find(
    (grant) => grant.subjectType === "group" && grant.accessLevel === "admin",
  );
  invariant(adminGrant, "expected root admin group grant");
  const revokeRequest = await buildRevokeRequest({
    parentKekState: null,
    previous: root.bundle,
    previousContainerPath: [root.bundle],
    previousKekState: root.kekState,
    revokedGrant: {
      subjectId: adminGrant.subjectId,
      subjectType: adminGrant.subjectType,
    },
    signer: owner,
  });

  const response = await postMutation({
    path: `/containers/${rootManifest.state.containerId}/revoke`,
    request: revokeRequest,
    token: owner.token,
  });

  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    error: "Group grants must be revoked atomically with principal rotation",
  });
});

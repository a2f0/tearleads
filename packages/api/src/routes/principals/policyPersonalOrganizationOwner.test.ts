import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { organizations } from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import { isOrganizationReadModelResponse } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import {
  addUserToAdminGroup,
  getCurrentOrganizationAdminAuthority,
} from "../../../test/helpers/organizationAdmin";
import { removeMemberGroupUser } from "../../../test/helpers/organizationMember";
import { addOrganizationMember } from "../../../test/helpers/organizationMembership";
import {
  createSignedPrincipalState,
  getDefaultOrganizationId,
  submitOrganizationGroupPolicyCommit,
} from "../../../test/helpers/principalPolicy";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";
import { runGetCurrentPrincipalPolicyWorkflow } from "../../workflows/principals/getCurrentPrincipalPolicy";

async function setup() {
  const owner = createTestUser();
  const peer = createTestUser();
  for (const user of [owner, peer]) {
    await registerUser(user);
    await authenticate(user);
  }
  const organizationId = await getDefaultOrganizationId(owner.userId);
  await addUserToAdminGroup({ actor: owner, member: peer, organizationId });
  const [organization] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  invariant(organization, "expected personal organization");
  return { owner, peer, organization };
}

async function readModel(organizationId: string, token: string) {
  const response = await routeApp.request(
    `/organizations/${organizationId}/read-model`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  expect(response.status).toBe(200);
  const body = await response.json();
  invariant(isOrganizationReadModelResponse(body), "expected read model");
  return body;
}

for (const signer of ["owner", "peer"] as const) {
  for (const group of ["adminGroupId", "memberGroupId"] as const) {
    test(`${signer} cannot remove the personal owner from ${group}`, async () => {
      const fixture = await setup();
      const { owner, peer, organization } = fixture;
      const actor = fixture[signer];
      const groupId = organization[group];
      const before = await readModel(organization.id, peer.token);
      const policy = await runGetCurrentPrincipalPolicyWorkflow(
        db,
        "group",
        groupId,
      );
      const projection = policy.currentProjection.filter(
        (member) => member.userId !== owner.userId,
      );
      const signed = await createSignedPrincipalState({
        principalType: "group",
        principalId: groupId,
        version: policy.currentState.version + 1,
        prevStateHash: policy.currentState.stateHash,
        keyEpoch: policy.currentState.keyEpoch + 1,
        externalAuthority:
          group === "memberGroupId"
            ? await getCurrentOrganizationAdminAuthority(organization.id)
            : null,
        grants: policy.currentGrants,
        members: projection.map(({ userId }) => ({ userId })),
        projection,
        signerUserId: actor.userId,
        signerUserKeyFingerprint: actor.fingerprint,
        signingPrivateKey: actor.signing.signingPrivateKey,
      });
      const response = await submitOrganizationGroupPolicyCommit({
        actor,
        organizationId: organization.id,
        groupId,
        groupPolicy: signed,
      });

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        error:
          "Personal organization owner must remain an active member and admin",
      });
      // Includes directory, group/org heads and the change-feed cursor: the
      // rejected signed commit must not produce a partial policy or roster event.
      expect(await readModel(organization.id, peer.token)).toEqual(before);
    }, 15_000);
  }
}

test("directory identifies the personal owner for another admin", async () => {
  const { owner, peer, organization } = await setup();
  const snapshot = await readModel(organization.id, peer.token);
  expect(snapshot.lanes.directory?.users).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        userId: owner.userId,
        isSelf: false,
        isPersonalOrganizationOwner: true,
        status: "active",
      }),
      expect.objectContaining({
        userId: peer.userId,
        isSelf: true,
        isPersonalOrganizationOwner: false,
      }),
    ]),
  );
}, 15_000);

test("a personal org still allows disabling another roster member", async () => {
  const { owner, organization } = await setup();
  const member = createTestUser();
  await registerUser(member);
  await addOrganizationMember({
    actor: owner,
    member,
    organizationId: organization.id,
  });
  await removeMemberGroupUser({
    actor: owner,
    memberUserId: member.userId,
    organizationId: organization.id,
  });
  const snapshot = await readModel(organization.id, owner.token);
  expect(snapshot.lanes.directory?.users).toContainEqual(
    expect.objectContaining({ userId: member.userId, status: "disabled" }),
  );
}, 15_000);

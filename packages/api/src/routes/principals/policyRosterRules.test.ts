import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  groups as groupsTable,
  organizationRosterEntries,
  organizations,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/test-utils";
import { isContainerMutationResponse } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import {
  bootstrapRoot,
  buildRootGrantRequest,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { addUserToAdminGroup } from "../../../test/helpers/organizationAdmin";
import { addOrganizationMember } from "../../../test/helpers/organizationMembership";
import {
  createSignedPrincipalState,
  getDefaultOrganizationId,
  putGroupPolicy,
} from "../../../test/helpers/principalPolicy";
import { registerUser } from "../../../test/helpers/registerUser";
import { getCurrentPrincipalState } from "../../access/read/principalStateStore";
import { routeApp } from "../../routeApp";

test("PUT /principals/:principalType/:principalId/policy syncs org roster from Members reachability", async () => {
  const actor = createTestUser();
  await registerUser(actor);
  await authenticate(actor);
  const member = createTestUser();
  await registerUser(member);

  const organizationId = await getDefaultOrganizationId(actor.userId);
  await addOrganizationMember({ actor, member, organizationId });
  const rosterEntries = await db
    .select({
      status: organizationRosterEntries.status,
      userId: organizationRosterEntries.userId,
    })
    .from(organizationRosterEntries)
    .where(eq(organizationRosterEntries.organizationId, organizationId));
  expect(rosterEntries).toContainEqual({
    status: "active",
    userId: member.userId,
  });
});

test("PUT /principals/:principalType/:principalId/policy rejects Admins users who are not organization members", async () => {
  const actor = createTestUser();
  await registerUser(actor);
  await authenticate(actor);
  const organizationId = await getDefaultOrganizationId(actor.userId);
  const outsider = createTestUser();
  await registerUser(outsider);

  const [organization] = await db
    .select({ adminGroupId: organizations.adminGroupId })
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  invariant(organization, "expected organization row");
  const currentAdmins = await getCurrentPrincipalState(
    "group",
    organization.adminGroupId,
    db,
  );
  invariant(currentAdmins, "expected current Admins state");

  const projection = [
    { userId: actor.userId, role: "admin" as const },
    { userId: outsider.userId, role: "admin" as const },
  ];
  const signedState = await createSignedPrincipalState({
    principalType: "group",
    principalId: organization.adminGroupId,
    version: currentAdmins.version + 1,
    prevStateHash: currentAdmins.stateHash,
    keyEpoch: currentAdmins.keyEpoch + 1,
    members: projection.map((projectionMember) => ({
      userId: projectionMember.userId,
    })),
    projection,
    signerUserId: actor.userId,
    signerUserKeyFingerprint: actor.fingerprint,
    signingPrivateKey: actor.signing.signingPrivateKey,
  });

  const response = await putGroupPolicy({
    actor,
    organizationId,
    principalId: organization.adminGroupId,
    signedState,
  });

  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    error: "Principal contains users who are not active organization members",
  });
});

test("PUT /principals/:principalType/:principalId/policy rejects a Members removal that strands an admin", async () => {
  // Removing someone from Members takes them off the roster but leaves Admins
  // untouched, which would leave an admin nobody can see and nobody bills.
  // Admins has to be unwound first — the order the disable flow already uses.
  const actor = createTestUser();
  await registerUser(actor);
  await authenticate(actor);
  const organizationId = await getDefaultOrganizationId(actor.userId);
  const admin = createTestUser();
  await registerUser(admin);
  await addUserToAdminGroup({ actor, member: admin, organizationId });

  const [organization] = await db
    .select({ memberGroupId: organizations.memberGroupId })
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  invariant(organization, "expected organization row");
  const currentMembers = await getCurrentPrincipalState(
    "group",
    organization.memberGroupId,
    db,
  );
  invariant(currentMembers, "expected current Members state");

  const projection = [{ userId: actor.userId, role: "admin" as const }];
  const signedState = await createSignedPrincipalState({
    principalType: "group",
    principalId: organization.memberGroupId,
    version: currentMembers.version + 1,
    prevStateHash: currentMembers.stateHash,
    keyEpoch: currentMembers.keyEpoch + 1,
    members: projection.map((projectionMember) => ({
      userId: projectionMember.userId,
    })),
    projection,
    signerUserId: actor.userId,
    signerUserKeyFingerprint: actor.fingerprint,
    signingPrivateKey: actor.signing.signingPrivateKey,
  });

  const response = await putGroupPolicy({
    actor,
    organizationId,
    principalId: organization.memberGroupId,
    signedState,
  });

  // The roster and policy removal roll back rather than stranding an admin.
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    error:
      "Remove users from other organization groups before removing them from Members",
  });
  expect(
    (await getCurrentPrincipalState("group", organization.memberGroupId, db))
      ?.version,
  ).toBe(currentMembers.version);
});

test("PUT Members policy rejects direct-grant removal and rolls back", async () => {
  const actor = createTestUser();
  await registerUser(actor);
  await authenticate(actor);
  const member = createTestUser();
  await registerUser(member);
  const root = await bootstrapRoot(actor);
  const grantRequest = await buildRootGrantRequest({
    previous: root.bundle,
    previousKekState: root.kekState,
    recipient: member,
    signer: actor,
  });
  const grantResponse = await routeApp.request(
    `/containers/${root.kekState.containerId}/share`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${actor.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(grantRequest),
    },
  );
  expect(grantResponse.status, await grantResponse.clone().text()).toBe(200);
  expect(isContainerMutationResponse(await grantResponse.json())).toBe(true);

  const organizationId = await getDefaultOrganizationId(actor.userId);
  const [organization] = await db
    .select({ memberGroupId: organizations.memberGroupId })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  invariant(organization, "expected organization row");
  const currentMembers = await getCurrentPrincipalState(
    "group",
    organization.memberGroupId,
    db,
  );
  invariant(currentMembers, "expected current Members state");
  const projection = [{ userId: actor.userId, role: "admin" as const }];
  const signedState = await createSignedPrincipalState({
    principalType: "group",
    principalId: organization.memberGroupId,
    version: currentMembers.version + 1,
    prevStateHash: currentMembers.stateHash,
    keyEpoch: currentMembers.keyEpoch + 1,
    members: projection.map(({ userId }) => ({ userId })),
    projection,
    signerUserId: actor.userId,
    signerUserKeyFingerprint: actor.fingerprint,
    signingPrivateKey: actor.signing.signingPrivateKey,
  });

  const removalResponse = await putGroupPolicy({
    actor,
    organizationId,
    principalId: organization.memberGroupId,
    signedState,
  });

  expect(removalResponse.status).toBe(409);
  expect(await removalResponse.json()).toEqual({
    error:
      "Members with direct container grants must be unshared before removal",
  });
  expect(
    (await getCurrentPrincipalState("group", organization.memberGroupId, db))
      ?.stateHash,
  ).toBe(currentMembers.stateHash);
  expect(
    await db
      .select({
        status: organizationRosterEntries.status,
        userId: organizationRosterEntries.userId,
      })
      .from(organizationRosterEntries)
      .where(eq(organizationRosterEntries.organizationId, organizationId)),
  ).toContainEqual({ status: "active", userId: member.userId });
});

test("PUT /principals/:principalType/:principalId/policy rejects disabled roster users in non-Members groups", async () => {
  const actor = createTestUser();
  await registerUser(actor);
  await authenticate(actor);
  const organizationId = await getDefaultOrganizationId(actor.userId);
  const disabledUser = createTestUser();
  await registerUser(disabledUser);
  await db.insert(organizationRosterEntries).values({
    organizationId,
    userId: disabledUser.userId,
    status: "disabled",
    disabledAt: new Date("2026-05-24T12:00:00.000Z"),
    disabledByUserId: actor.userId,
  });

  const groupId = crypto.randomUUID();
  await db.insert(groupsTable).values({
    id: groupId,
    organizationId,
  });
  const projection = [
    {
      userId: actor.userId,
      role: "admin" as const,
    },
    {
      userId: disabledUser.userId,
      role: "member" as const,
    },
  ];
  const signedState = await createSignedPrincipalState({
    principalType: "group",
    principalId: groupId,
    members: projection.map((projectionMember) => ({
      userId: projectionMember.userId,
    })),
    projection,
    signerUserId: actor.userId,
    signerUserKeyFingerprint: actor.fingerprint,
    signingPrivateKey: actor.signing.signingPrivateKey,
  });

  const response = await putGroupPolicy({
    actor,
    organizationId,
    principalId: groupId,
    signedState,
  });

  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    error: "Principal contains disabled organization users",
  });
  expect(await getCurrentPrincipalState("group", groupId, db)).toBeNull();
});

import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  accessManifestHeads,
  groups as groupsTable,
  organizationRosterEntries,
  organizations,
  users,
} from "@tearleads/api-shared/schema";
import { createTestUser, type TestUser } from "@tearleads/bob-and-alice";
import { toFingerprint } from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  isCreateOrganizationGroupResponse,
  isDeleteOrganizationGroupResponse,
  isOrganizationDataUsageResponse,
  isOrganizationDirectoryUserResponse,
  isOrganizationGroupMembersResponse,
  isOrganizationProfileResponse,
  isOrganizationReadModelResponse,
} from "@tearleads/validators/response";
import { and, eq } from "drizzle-orm";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import { addUserToAdminGroup } from "../../../test/helpers/organizationAdmin";
import { seedOrganizationDataUsage } from "../../../test/helpers/organizationDataUsage";
import {
  createGroupRequest,
  deleteGroupRequest,
} from "../../../test/helpers/organizationGroup";
import { addMemberGroupUser } from "../../../test/helpers/organizationMember";
import { registerUser } from "../../../test/helpers/registerUser";
import { getCurrentPrincipalState } from "../../access/read/principalStateStore";
import { routeApp } from "../../routeApp";
import { upsertActiveOrganizationRosterEntries } from "../../workflows/organizations/roster";

async function registerAndAuthenticate(user: TestUser): Promise<string> {
  await registerUser(user);
  await authenticate(user);

  const [row] = await db
    .select({ organizationId: users.defaultOrganizationId })
    .from(users)
    .where(eq(users.id, user.userId));

  invariant(row, "expected registered user row");
  return row.organizationId;
}

async function loadOrganizationReadModelSnapshot(
  actor: TestUser,
  organizationId: string,
) {
  const response = await routeApp.request(
    `/organizations/${organizationId}/read-model`,
    { headers: { Authorization: `Bearer ${actor.token}` } },
  );
  expect(response.status).toBe(200);
  const body = await response.json();
  invariant(
    isOrganizationReadModelResponse(body) && body.mode === "snapshot",
    "expected organization read-model snapshot",
  );
  return body;
}

test("organization read model includes the current org directory", async () => {
  const actor = createTestUser();
  const organizationId = await registerAndAuthenticate(actor);
  const snapshot = await loadOrganizationReadModelSnapshot(
    actor,
    organizationId,
  );
  const body = snapshot.lanes.directory;
  expect(body.organizationId).toBe(organizationId);
  expect(body.profileDocumentId).toBeNull();
  expect(snapshot.currentUser.isOrgAdmin).toBe(true);
  expect(body.users).toHaveLength(1);
  expect(body.users[0]?.userId).toBe(actor.userId);
  expect(body.users[0]?.isSelf).toBe(true);
  expect(body.users[0]?.status).toBe("active");
  expect(body.users[0]?.profileDocumentId).toBeNull();
  expect(body.users[0]?.disabledAt).toBeNull();
});

test("roster reconcile does not churn updatedAt for unchanged active members", async () => {
  const actor = createTestUser();
  const organizationId = await registerAndAuthenticate(actor);

  const rosterEntryWhere = and(
    eq(organizationRosterEntries.organizationId, organizationId),
    eq(organizationRosterEntries.userId, actor.userId),
  );

  // Ensure an active roster row exists, then pin it to a fixed past updatedAt.
  const unchangedUserIds = await upsertActiveOrganizationRosterEntries({
    executor: db,
    organizationId,
    userIds: [actor.userId],
  });
  expect(unchangedUserIds).toEqual([]);
  // A safely-past date so the re-activation assertion below (updatedAt bumped
  // to new Date()) holds regardless of the runner's system clock.
  const pinnedUpdatedAt = new Date("2020-01-01T00:00:00.000Z");
  await db
    .update(organizationRosterEntries)
    .set({
      status: "active",
      disabledAt: null,
      disabledByUserId: null,
      updatedAt: pinnedUpdatedAt,
    })
    .where(rosterEntryWhere);

  // Re-asserting an already-active member is a no-op and must NOT bump updatedAt
  // (otherwise the timestamp tracks read time, not change time).
  const repeatedUserIds = await upsertActiveOrganizationRosterEntries({
    executor: db,
    organizationId,
    userIds: [actor.userId],
  });
  expect(repeatedUserIds).toEqual([]);

  const [afterNoop] = await db
    .select({
      status: organizationRosterEntries.status,
      updatedAt: organizationRosterEntries.updatedAt,
    })
    .from(organizationRosterEntries)
    .where(rosterEntryWhere);
  expect(afterNoop?.status).toBe("active");
  expect(afterNoop?.updatedAt.toISOString()).toBe(
    pinnedUpdatedAt.toISOString(),
  );

  // A genuine re-activation of a disabled member DOES bump updatedAt.
  await db
    .update(organizationRosterEntries)
    .set({
      status: "disabled",
      disabledAt: new Date("2020-02-01T00:00:00.000Z"),
      disabledByUserId: actor.userId,
      updatedAt: pinnedUpdatedAt,
    })
    .where(rosterEntryWhere);
  const reactivatedUserIds = await upsertActiveOrganizationRosterEntries({
    executor: db,
    organizationId,
    userIds: [actor.userId],
  });
  expect(reactivatedUserIds).toEqual([actor.userId]);

  const [afterReactivate] = await db
    .select({
      status: organizationRosterEntries.status,
      disabledAt: organizationRosterEntries.disabledAt,
      updatedAt: organizationRosterEntries.updatedAt,
    })
    .from(organizationRosterEntries)
    .where(rosterEntryWhere);
  expect(afterReactivate?.status).toBe("active");
  expect(afterReactivate?.disabledAt).toBeNull();
  expect(afterReactivate?.updatedAt.getTime()).toBeGreaterThan(
    pinnedUpdatedAt.getTime(),
  );
});

test("org manager routes keep disabled roster entries visible outside access groups", async () => {
  const actor = createTestUser();
  const organizationId = await registerAndAuthenticate(actor);
  const disabledUser = createTestUser();
  await registerAndAuthenticate(disabledUser);
  const disabledAt = new Date("2026-05-13T12:00:00.000Z");

  await db.insert(organizationRosterEntries).values({
    organizationId,
    userId: disabledUser.userId,
    status: "disabled",
    disabledAt,
    disabledByUserId: actor.userId,
  });

  const directoryBody = (
    await loadOrganizationReadModelSnapshot(actor, organizationId)
  ).lanes.directory;
  expect(
    directoryBody.users.map((user) => [
      user.userId,
      user.status,
      user.disabledByUserId,
    ]),
  ).toContainEqual([disabledUser.userId, "disabled", actor.userId]);

  const disabledUserDirectoryResponse = await routeApp.request(
    `/organizations/${organizationId}/read-model`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${disabledUser.token}` },
    },
  );
  expect(disabledUserDirectoryResponse.status).toBe(403);
});

test("org manager routes let admins bind an encrypted roster profile document", async () => {
  const actor = createTestUser();
  const organizationId = await registerAndAuthenticate(actor);

  const response = await routeApp.request(
    `/organizations/${organizationId}/roster/${actor.userId}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${actor.token}`,
      },
      body: JSON.stringify({ profileDocumentId: null }),
    },
  );

  expect(response.status).toBe(200);
  const body = await response.json();
  invariant(
    isOrganizationDirectoryUserResponse(body),
    "expected organization roster user response",
  );
  expect(body.userId).toBe(actor.userId);
  expect(body.profileDocumentId).toBeNull();
  expect(body.status).toBe("active");
});

test("org manager routes let admins bind an encrypted organization profile document", async () => {
  const actor = createTestUser();
  const organizationId = await registerAndAuthenticate(actor);
  const profileDocumentId = crypto.randomUUID();

  await db.insert(accessManifestHeads).values({
    objectKind: "document",
    objectId: profileDocumentId,
    organizationId,
    epoch: 1,
    manifestHash: `organization-profile-manifest:${crypto.randomUUID()}`,
  });

  const response = await routeApp.request(
    `/organizations/${organizationId}/profile`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${actor.token}`,
      },
      body: JSON.stringify({ profileDocumentId }),
    },
  );

  expect(response.status).toBe(200);
  const body = await response.json();
  invariant(
    isOrganizationProfileResponse(body),
    "expected organization profile response",
  );
  expect(body).toEqual({
    organizationId,
    profileDocumentId,
  });

  const snapshot = await loadOrganizationReadModelSnapshot(
    actor,
    organizationId,
  );
  expect(snapshot.lanes.directory.profileDocumentId).toBe(profileDocumentId);
});

test("org manager routes reject users outside the organization", async () => {
  const actor = createTestUser();
  const organizationId = await registerAndAuthenticate(actor);
  const intruder = createTestUser();
  await registerAndAuthenticate(intruder);

  const response = await routeApp.request(
    `/organizations/${organizationId}/read-model`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${intruder.token}` },
    },
  );

  expect(response.status).toBe(403);
});

test("organization read model includes the bootstrap Admins group", async () => {
  const actor = createTestUser();
  const organizationId = await registerAndAuthenticate(actor);
  const [organization] = await db
    .select({
      adminGroupId: organizations.adminGroupId,
      memberGroupId: organizations.memberGroupId,
    })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  invariant(organization, "expected organization row");

  const listBody = (
    await loadOrganizationReadModelSnapshot(actor, organizationId)
  ).lanes.groups;
  expect(listBody.memberGroupId).toBe(organization.memberGroupId);
  expect(listBody.groups.map((group) => group.groupId)).toEqual([
    organization.adminGroupId,
  ]);
  expect(listBody.groups.map((group) => group.groupId)).not.toContain(
    organization.memberGroupId,
  );
  expect(listBody.groups.map((group) => group.name)).toEqual(["Admins"]);
  expect(listBody.groups[0]?.isBuiltin).toBe(true);
  expect(listBody.groups[0]?.currentState?.memberCount).toBe(1);
});

test("legacy organization projection routes are absent", async () => {
  const actor = createTestUser();
  const organizationId = await registerAndAuthenticate(actor);
  const [organization] = await db
    .select({ adminGroupId: organizations.adminGroupId })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  invariant(organization, "expected organization row");

  const paths = [
    `/organizations/${organizationId}/directory`,
    `/organizations/${organizationId}/grants`,
    `/organizations/${organizationId}/groups`,
    `/organizations/${organizationId}/groups/${organization.adminGroupId}/containers`,
    `/organizations/${organizationId}/users/${actor.userId}/detail`,
  ];
  for (const path of paths) {
    const response = await routeApp.request(path, {
      method: "GET",
      headers: { Authorization: `Bearer ${actor.token}` },
    });
    expect(response.status).toBe(404);
  }
});

test("org manager routes report organization data usage", async () => {
  const actor = createTestUser();
  const organizationId = await registerAndAuthenticate(actor);
  const expectedUsage = await seedOrganizationDataUsage({
    actor,
    organizationId,
  });

  const response = await routeApp.request(
    `/organizations/${organizationId}/data-usage`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${actor.token}` },
    },
  );

  expect(response.status).toBe(200);
  const body = await response.json();
  invariant(
    isOrganizationDataUsageResponse(body),
    "expected organization data usage response",
  );
  expect(body).toEqual({
    organizationId,
    ...expectedUsage,
  });
});

test("org manager routes allow organization members to read but reserve mutations for Admins members", async () => {
  const actor = createTestUser();
  const organizationId = await registerAndAuthenticate(actor);
  const member = createTestUser();
  await registerAndAuthenticate(member);
  await addMemberGroupUser({
    actor,
    memberUserId: member.userId,
    organizationId,
  });

  const memberSnapshot = await loadOrganizationReadModelSnapshot(
    member,
    organizationId,
  );
  const directoryBody = memberSnapshot.lanes.directory;
  expect(memberSnapshot.currentUser.isOrgAdmin).toBe(false);
  expect(directoryBody.users.map((user) => user.userId)).toEqual(
    [actor.userId, member.userId].sort(),
  );

  const createResponse = await routeApp.request(
    `/organizations/${organizationId}/groups`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${member.token}`,
      },
      body: JSON.stringify(
        await createGroupRequest({
          actor: member,
          groupId: crypto.randomUUID(),
          name: "Operators",
        }),
      ),
    },
  );

  expect(createResponse.status).toBe(403);

  const selfRosterResponse = await routeApp.request(
    `/organizations/${organizationId}/roster/${member.userId}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${member.token}`,
      },
      body: JSON.stringify({ profileDocumentId: null }),
    },
  );
  expect(selfRosterResponse.status).toBe(200);

  const otherRosterResponse = await routeApp.request(
    `/organizations/${organizationId}/roster/${actor.userId}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${member.token}`,
      },
      body: JSON.stringify({ profileDocumentId: null }),
    },
  );
  expect(otherRosterResponse.status).toBe(403);

  const organizationProfileResponse = await routeApp.request(
    `/organizations/${organizationId}/profile`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${member.token}`,
      },
      body: JSON.stringify({ profileDocumentId: null }),
    },
  );
  expect(organizationProfileResponse.status).toBe(403);
});

test("org manager routes let admins create empty externally-administered groups", async () => {
  const actor = createTestUser();
  const organizationId = await registerAndAuthenticate(actor);
  const groupId = crypto.randomUUID();

  const createResponse = await routeApp.request(
    `/organizations/${organizationId}/groups`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${actor.token}`,
      },
      body: JSON.stringify(
        await createGroupRequest({
          actor,
          groupId,
          includeActorAsAdmin: false,
          name: "Operators",
        }),
      ),
    },
  );

  expect(createResponse.status).toBe(200);
  const createBody = await createResponse.json();
  invariant(
    isCreateOrganizationGroupResponse(createBody),
    "expected organization group summary response",
  );
  expect(createBody.group.groupId).toBe(groupId);
  expect(createBody.group.name).toBe("Operators");
  expect(createBody.group.isBuiltin).toBe(false);
  expect(createBody.group.currentState?.memberCount).toBe(0);

  const membersResponse = await routeApp.request(
    `/organizations/${organizationId}/groups/${groupId}/members`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${actor.token}` },
    },
  );
  expect(membersResponse.status).toBe(200);
  const membersBody = await membersResponse.json();
  invariant(
    isOrganizationGroupMembersResponse(membersBody),
    "expected organization group members response",
  );
  expect(membersBody.members).toEqual([]);
});

test("org manager group creation rejects a stale signed Admins authority head", async () => {
  const actor = createTestUser();
  const organizationId = await registerAndAuthenticate(actor);
  const futureAdmin = createTestUser();
  await registerAndAuthenticate(futureAdmin);
  const groupId = crypto.randomUUID();
  const request = await createGroupRequest({
    actor,
    groupId,
    includeActorAsAdmin: false,
    name: "Stale authority",
  });
  await addUserToAdminGroup({
    actor,
    member: futureAdmin,
    organizationId,
  });

  const response = await routeApp.request(
    `/organizations/${organizationId}/groups`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${actor.token}`,
      },
      body: JSON.stringify(request),
    },
  );

  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({
    error: "Principal state signer must be an admin",
  });
  expect(
    await db
      .select({ groupId: groupsTable.id })
      .from(groupsTable)
      .where(eq(groupsTable.id, groupId)),
  ).toEqual([]);
  expect(await getCurrentPrincipalState("group", groupId, db)).toBeNull();
});

test("org manager routes create and list groups with members", async () => {
  const actor = createTestUser();
  const organizationId = await registerAndAuthenticate(actor);
  const [organization] = await db
    .select({ adminGroupId: organizations.adminGroupId })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  invariant(organization, "expected organization row");
  const groupId = crypto.randomUUID();

  const createResponse = await routeApp.request(
    `/organizations/${organizationId}/groups`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${actor.token}`,
      },
      body: JSON.stringify(
        await createGroupRequest({
          actor,
          groupId,
          name: "Operators",
        }),
      ),
    },
  );

  expect(createResponse.status).toBe(200);
  const createBody = await createResponse.json();
  invariant(
    isCreateOrganizationGroupResponse(createBody),
    "expected organization group summary response",
  );
  expect(createBody.group.groupId).toBe(groupId);
  expect(createBody.group.name).toBe("Operators");
  expect(createBody.group.isBuiltin).toBe(false);
  expect(createBody.group.currentState?.memberCount).toBe(1);

  const listBody = (
    await loadOrganizationReadModelSnapshot(actor, organizationId)
  ).lanes.groups;
  expect(listBody.groups.map((group) => group.groupId)).toContain(groupId);
  expect(listBody.groups.map((group) => group.name)).toEqual([
    "Admins",
    "Operators",
  ]);

  const membersResponse = await routeApp.request(
    `/organizations/${organizationId}/groups/${groupId}/members`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${actor.token}` },
    },
  );
  expect(membersResponse.status).toBe(200);
  const membersBody = await membersResponse.json();
  invariant(
    isOrganizationGroupMembersResponse(membersBody),
    "expected organization group members response",
  );
  expect(membersBody.members).toEqual([
    {
      userId: actor.userId,
      role: "admin",
      signingKeyFingerprint: actor.fingerprint,
      signingPublicKey: bytesToBase64(actor.signing.signingPublicKey),
      encapsulationPublicKey: bytesToBase64(actor.kem.publicKey),
      encapsulationKeyFingerprint: await toFingerprint(actor.kem.publicKey),
    },
  ]);

  const builtinDeleteResponse = await deleteGroupRequest({
    actor,
    groupId: organization.adminGroupId,
    organizationId,
  });
  expect(builtinDeleteResponse.status).toBe(409);

  const deleteResponse = await deleteGroupRequest({
    actor,
    groupId,
    organizationId,
  });
  expect(deleteResponse.status).toBe(200);
  const deleteBody = await deleteResponse.json();
  invariant(
    isDeleteOrganizationGroupResponse(deleteBody),
    "expected delete organization group response",
  );
  expect(deleteBody).toEqual({
    deleted: true,
    groupId,
    organizationPolicy: expect.objectContaining({
      currentState: expect.objectContaining({
        principalId: organizationId,
        principalType: "organization",
      }),
    }),
    organizationId,
  });

  const postDeleteListBody = (
    await loadOrganizationReadModelSnapshot(actor, organizationId)
  ).lanes.groups;
  expect(
    postDeleteListBody.groups.map((deletedGroup) => deletedGroup.groupId),
  ).not.toContain(groupId);
});

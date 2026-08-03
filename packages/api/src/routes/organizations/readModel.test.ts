import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { groups as groupsTable, users } from "@tearleads/api-shared/schema";
import { createTestUser, type TestUser } from "@tearleads/bob-and-alice";
import {
  isOrganizationGroupSummaryResponse,
  isOrganizationReadModelResponse,
} from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import { addUserToAdminGroup } from "../../../test/helpers/organizationAdmin";
import { createGroupRequest } from "../../../test/helpers/organizationGroup";
import {
  addMemberGroupUser,
  removeMemberGroupUser,
} from "../../../test/helpers/organizationMember";
import { registerUser } from "../../../test/helpers/registerUser";
import { getCurrentPrincipalState } from "../../access/read/principalStateStore";
import { routeApp } from "../../routeApp";
import { encodeOrganizationReadModelCursor } from "../../workflows/organizations/readModelCursor";

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

function readModelPath(organizationId: string, cursor?: string): string {
  const path = `/organizations/${organizationId}/read-model`;
  return cursor === undefined
    ? path
    : `${path}?${new URLSearchParams({ cursor }).toString()}`;
}

test("organization read-model route snapshots and coalesces group changes", async () => {
  const actor = createTestUser();
  const organizationId = await registerAndAuthenticate(actor);
  const statelessGroupId = crypto.randomUUID();
  await db.insert(groupsTable).values({
    id: statelessGroupId,
    name: "Catalog only",
    organizationId,
  });

  const snapshotResponse = await routeApp.request(
    readModelPath(organizationId),
    {
      headers: { Authorization: `Bearer ${actor.token}` },
    },
  );
  expect(snapshotResponse.status).toBe(200);
  expect(snapshotResponse.headers.get("Cache-Control")).toBe(
    "private, no-store",
  );
  const snapshot = await snapshotResponse.json();
  invariant(
    isOrganizationReadModelResponse(snapshot) && snapshot.mode === "snapshot",
    "expected organization read-model snapshot",
  );
  expect(snapshot.lanes.directory.users.map((user) => user.userId)).toEqual([
    actor.userId,
  ]);
  expect(snapshot.currentUser.isOrgAdmin).toBe(true);
  expect(Reflect.has(snapshot.lanes.directory, "currentUser")).toBe(false);
  expect(snapshot.lanes.groups.groups.map((group) => group.name)).toEqual([
    "Admins",
    "Catalog only",
  ]);
  expect(snapshot.version).toBe(4);
  expect(snapshot.lanes.organizationPolicy).toEqual({
    organizationId,
    currentState: expect.objectContaining({
      keyEpoch: 1,
      keyFingerprint: expect.any(String),
      memberCount: 1,
      stateHash: expect.any(String),
      version: 1,
    }),
  });
  expect(snapshot.lanes.grants.organizationId).toBe(organizationId);
  expect(snapshot.lanes.grants.grants.length).toBeGreaterThan(0);
  expect(snapshot.lanes.groupMemberships.deletedGroupIds).toEqual([]);
  expect(snapshot.lanes.groupMemberships.groups).toHaveLength(2);
  expect(
    snapshot.lanes.groupMemberships.groups.map((group) => group.groupId),
  ).toContain(snapshot.lanes.groups.memberGroupId);
  expect(
    snapshot.lanes.groupMemberships.groups.map((group) => group.groupId),
  ).not.toContain(statelessGroupId);
  const adminGroupId = snapshot.lanes.groups.groups[0]?.groupId;
  invariant(adminGroupId, "expected Admins group");
  expect(snapshot.lanes.groups.groups[0]?.currentState?.keyFingerprint).toEqual(
    expect.any(String),
  );

  const unchangedResponse = await routeApp.request(
    readModelPath(organizationId, snapshot.nextCursor),
    { headers: { Authorization: `Bearer ${actor.token}` } },
  );
  const unchanged = await unchangedResponse.json();
  invariant(
    isOrganizationReadModelResponse(unchanged) && unchanged.mode === "delta",
    "expected empty organization read-model delta",
  );
  expect(unchanged.lanes).toEqual({});
  expect(unchanged.currentUser.isOrgAdmin).toBe(true);
  expect(unchanged.nextCursor).toBe(snapshot.nextCursor);

  const groupId = crypto.randomUUID();
  const groupRequest = await createGroupRequest({
    actor,
    groupId,
    name: "Operators",
    nestedGroupIds: [adminGroupId],
  });
  const createResponse = await routeApp.request(
    `/organizations/${organizationId}/groups`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${actor.token}`,
      },
      body: JSON.stringify(groupRequest),
    },
  );
  const created = await createResponse.json();
  invariant(
    isOrganizationGroupSummaryResponse(created),
    "expected created organization group",
  );

  const changedResponse = await routeApp.request(
    readModelPath(organizationId, snapshot.nextCursor),
    { headers: { Authorization: `Bearer ${actor.token}` } },
  );
  const changed = await changedResponse.json();
  invariant(
    isOrganizationReadModelResponse(changed) && changed.mode === "delta",
    "expected organization read-model delta",
  );
  expect(changed.lanes.directory).toBeUndefined();
  expect(changed.lanes.grants).toBeUndefined();
  expect(changed.lanes.groups?.groups.map((group) => group.name)).toEqual([
    "Admins",
    "Catalog only",
    "Operators",
  ]);
  expect(changed.lanes.groupMemberships?.deletedGroupIds).toEqual([]);
  expect(changed.lanes.groupMemberships?.groups).toHaveLength(1);
  expect(changed.lanes.groupMemberships?.groups[0]?.groupId).toBe(groupId);
  expect(changed.lanes.groupMemberships?.groups[0]?.stateHash).toBe(
    created.currentState?.stateHash,
  );
  expect(changed.lanes.groupMemberships?.groups[0]?.members).toContainEqual(
    expect.objectContaining({
      groupId: adminGroupId,
      groupName: "Admins",
      userId: adminGroupId,
    }),
  );

  const rejectedReplay = await routeApp.request(
    `/organizations/${organizationId}/groups`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${actor.token}`,
      },
      body: JSON.stringify(groupRequest),
    },
  );
  expect(rejectedReplay.status).toBe(409);
  const afterRejectedResponse = await routeApp.request(
    readModelPath(organizationId, changed.nextCursor),
    { headers: { Authorization: `Bearer ${actor.token}` } },
  );
  const afterRejected = await afterRejectedResponse.json();
  invariant(
    isOrganizationReadModelResponse(afterRejected) &&
      afterRejected.mode === "delta",
    "expected delta after rejected group replay",
  );
  expect(afterRejected.lanes).toEqual({});

  const exactPolicyReplayResponse = await routeApp.request(
    `/principals/group/${groupId}/policy`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${actor.token}`,
      },
      body: JSON.stringify(groupRequest.initialGroupPolicy),
    },
  );
  expect(exactPolicyReplayResponse.status).toBe(200);
  const afterExactReplayResponse = await routeApp.request(
    readModelPath(organizationId, changed.nextCursor),
    { headers: { Authorization: `Bearer ${actor.token}` } },
  );
  const afterExactReplay = await afterExactReplayResponse.json();
  invariant(
    isOrganizationReadModelResponse(afterExactReplay) &&
      afterExactReplay.mode === "delta",
    "expected delta after exact policy replay",
  );
  expect(afterExactReplay.lanes).toEqual({});

  const deleteResponse = await routeApp.request(
    `/organizations/${organizationId}/groups/${groupId}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${actor.token}` } },
  );
  expect(deleteResponse.status).toBe(200);
  const deletedDeltaResponse = await routeApp.request(
    readModelPath(organizationId, changed.nextCursor),
    { headers: { Authorization: `Bearer ${actor.token}` } },
  );
  const deletedDelta = await deletedDeltaResponse.json();
  invariant(
    isOrganizationReadModelResponse(deletedDelta) &&
      deletedDelta.mode === "delta",
    "expected group deletion delta",
  );
  expect(deletedDelta.lanes.groups?.groups.map((group) => group.name)).toEqual([
    "Admins",
    "Catalog only",
  ]);
  expect(deletedDelta.lanes.groupMemberships).toEqual({
    organizationId,
    deletedGroupIds: [groupId],
    groups: [],
  });
});

test("Members and Admins policy changes invalidate exact membership rows", async () => {
  const owner = createTestUser();
  const organizationId = await registerAndAuthenticate(owner);
  const member = createTestUser();
  await registerAndAuthenticate(member);
  const beforeMembersResponse = await routeApp.request(
    readModelPath(organizationId),
    { headers: { Authorization: `Bearer ${owner.token}` } },
  );
  const beforeMembers = await beforeMembersResponse.json();
  invariant(
    isOrganizationReadModelResponse(beforeMembers) &&
      beforeMembers.mode === "snapshot",
    "expected snapshot before Members change",
  );
  await addMemberGroupUser({
    actor: owner,
    memberUserId: member.userId,
    organizationId,
  });

  const membersDeltaResponse = await routeApp.request(
    readModelPath(organizationId, beforeMembers.nextCursor),
    { headers: { Authorization: `Bearer ${owner.token}` } },
  );
  const membersDelta = await membersDeltaResponse.json();
  invariant(
    isOrganizationReadModelResponse(membersDelta) &&
      membersDelta.mode === "delta",
    "expected Members membership delta",
  );
  const memberGroupId = beforeMembers.lanes.groups.memberGroupId;
  const memberGroupState = await getCurrentPrincipalState(
    "group",
    memberGroupId,
    db,
  );
  invariant(memberGroupState, "expected current Members state");
  expect(membersDelta.lanes.groups).toBeUndefined();
  expect(membersDelta.lanes.groupMemberships).toEqual({
    organizationId,
    deletedGroupIds: [],
    groups: [
      expect.objectContaining({
        groupId: memberGroupId,
        stateHash: memberGroupState.stateHash,
        members: expect.arrayContaining([
          expect.objectContaining({
            userId: member.userId,
          }),
        ]),
      }),
    ],
  });

  const initialResponse = await routeApp.request(
    readModelPath(organizationId),
    {
      headers: { Authorization: `Bearer ${member.token}` },
    },
  );
  const initial = await initialResponse.json();
  invariant(
    isOrganizationReadModelResponse(initial) && initial.mode === "snapshot",
    "expected existing member snapshot",
  );
  expect(initial.currentUser.isOrgAdmin).toBe(false);

  await addUserToAdminGroup({ actor: owner, member, organizationId });

  const deltaResponse = await routeApp.request(
    readModelPath(organizationId, initial.nextCursor),
    { headers: { Authorization: `Bearer ${member.token}` } },
  );
  const delta = await deltaResponse.json();
  invariant(
    isOrganizationReadModelResponse(delta) && delta.mode === "delta",
    "expected Admins membership delta",
  );
  expect(delta.currentUser.isOrgAdmin).toBe(true);
  expect(delta.lanes.directory).toBeUndefined();
  expect(delta.lanes.groups).toBeDefined();
  expect(delta.lanes.groupMemberships?.deletedGroupIds).toEqual([]);
  expect(delta.lanes.groupMemberships?.groups).toHaveLength(1);
  expect(delta.lanes.groupMemberships?.groups[0]?.groupId).not.toBe(
    memberGroupId,
  );
});

test("membership deltas coalesce transitions to final entity state", async () => {
  const owner = createTestUser();
  const organizationId = await registerAndAuthenticate(owner);
  const member = createTestUser();
  await registerAndAuthenticate(member);
  const initialResponse = await routeApp.request(
    readModelPath(organizationId),
    {
      headers: { Authorization: `Bearer ${owner.token}` },
    },
  );
  const initial = await initialResponse.json();
  invariant(
    isOrganizationReadModelResponse(initial) && initial.mode === "snapshot",
    "expected initial membership snapshot",
  );

  const memberMutation = {
    actor: owner,
    memberUserId: member.userId,
    organizationId,
  };
  await addMemberGroupUser(memberMutation);
  await removeMemberGroupUser(memberMutation);

  const deletedGroupId = crypto.randomUUID();
  const createResponse = await routeApp.request(
    `/organizations/${organizationId}/groups`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${owner.token}`,
      },
      body: JSON.stringify(
        await createGroupRequest({
          actor: owner,
          groupId: deletedGroupId,
          name: "Ephemeral",
        }),
      ),
    },
  );
  expect(createResponse.status).toBe(200);
  const deleteResponse = await routeApp.request(
    `/organizations/${organizationId}/groups/${deletedGroupId}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${owner.token}` },
    },
  );
  expect(deleteResponse.status).toBe(200);

  const deltaResponse = await routeApp.request(
    readModelPath(organizationId, initial.nextCursor),
    { headers: { Authorization: `Bearer ${owner.token}` } },
  );
  const delta = await deltaResponse.json();
  invariant(
    isOrganizationReadModelResponse(delta) && delta.mode === "delta",
    "expected coalesced membership delta",
  );
  const memberGroupId = initial.lanes.groups.memberGroupId;
  expect(delta.lanes.groupMemberships?.deletedGroupIds).toEqual([
    deletedGroupId,
  ]);
  expect(delta.lanes.groupMemberships?.groups).toHaveLength(1);
  expect(delta.lanes.groupMemberships?.groups[0]?.groupId).toBe(memberGroupId);
  expect(
    delta.lanes.groupMemberships?.groups[0]?.members.some(
      (projectedMember) =>
        projectedMember.userId === "user" &&
        projectedMember.userId === member.userId,
    ),
  ).toBe(false);
  expect(
    delta.lanes.groups?.groups.some((group) => group.name === "Ephemeral"),
  ).toBe(false);
});

test("organization read-model route validates cursor scope after access", async () => {
  const actor = createTestUser();
  const organizationId = await registerAndAuthenticate(actor);
  const other = createTestUser();
  const otherOrganizationId = await registerAndAuthenticate(other);

  const invalidCursorResponse = await routeApp.request(
    readModelPath(organizationId, ""),
    { headers: { Authorization: `Bearer ${actor.token}` } },
  );
  expect(invalidCursorResponse.status).toBe(400);

  const crossOrganizationResponse = await routeApp.request(
    readModelPath(
      organizationId,
      encodeOrganizationReadModelCursor(otherOrganizationId, 0n),
    ),
    { headers: { Authorization: `Bearer ${actor.token}` } },
  );
  expect(crossOrganizationResponse.status).toBe(400);

  const outsiderResponse = await routeApp.request(
    readModelPath(organizationId, "malformed"),
    { headers: { Authorization: `Bearer ${other.token}` } },
  );
  expect(outsiderResponse.status).toBe(403);

  const missingResponse = await routeApp.request(
    readModelPath(crypto.randomUUID()),
    { headers: { Authorization: `Bearer ${actor.token}` } },
  );
  expect(missingResponse.status).toBe(404);
});

test("no-op organization profile writes do not advance the read model", async () => {
  const actor = createTestUser();
  const organizationId = await registerAndAuthenticate(actor);
  const initialResponse = await routeApp.request(
    readModelPath(organizationId),
    {
      headers: { Authorization: `Bearer ${actor.token}` },
    },
  );
  const initial = await initialResponse.json();
  invariant(
    isOrganizationReadModelResponse(initial),
    "expected initial organization read model",
  );

  for (const path of [
    `/organizations/${organizationId}/roster/${actor.userId}`,
    `/organizations/${organizationId}/profile`,
  ]) {
    const response = await routeApp.request(path, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${actor.token}`,
      },
      body: JSON.stringify({ profileDocumentId: null }),
    });
    expect(response.status).toBe(200);
  }

  const deltaResponse = await routeApp.request(
    readModelPath(organizationId, initial.nextCursor),
    { headers: { Authorization: `Bearer ${actor.token}` } },
  );
  const delta = await deltaResponse.json();
  invariant(
    isOrganizationReadModelResponse(delta) && delta.mode === "delta",
    "expected organization read-model delta",
  );
  expect(delta.lanes).toEqual({});
  expect(delta.nextCursor).toBe(initial.nextCursor);
});

import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  organizationRosterEntries,
  organizations,
  principalContainerGrantProjection,
  users,
} from "@tearleads/api-shared/schema";
import { createTestUser, type TestUser } from "@tearleads/bob-and-alice";
import { isOrganizationReadModelResponse } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import {
  createGroupRequest,
  deleteGroupRequest,
} from "../../../test/helpers/organizationGroup";
import { registerUser } from "../../../test/helpers/registerUser";
import { getCurrentPrincipalState } from "../../access/read/principalStateStore";
import { routeApp } from "../../routeApp";

async function registerActor(user: TestUser) {
  await registerUser(user);
  await authenticate(user);
  const [row] = await db
    .select({
      adminGroupId: organizations.adminGroupId,
      organizationId: users.defaultOrganizationId,
    })
    .from(users)
    .innerJoin(organizations, eq(organizations.id, users.defaultOrganizationId))
    .where(eq(users.id, user.userId));
  invariant(row, "expected registered organization");
  return row;
}

async function readSnapshot(actor: TestUser, organizationId: string) {
  const response = await routeApp.request(
    `/organizations/${organizationId}/read-model`,
    { headers: { Authorization: `Bearer ${actor.token}` } },
  );
  const body = await response.json();
  invariant(
    isOrganizationReadModelResponse(body) && body.mode === "snapshot",
    "expected organization read-model snapshot",
  );
  return body;
}

async function expectNoChange(
  actor: TestUser,
  organizationId: string,
  cursor: string,
) {
  const response = await routeApp.request(
    `/organizations/${organizationId}/read-model?${new URLSearchParams({ cursor })}`,
    { headers: { Authorization: `Bearer ${actor.token}` } },
  );
  const body = await response.json();
  invariant(
    isOrganizationReadModelResponse(body) && body.mode === "delta",
    "expected organization read-model delta",
  );
  expect(body.lanes).toEqual({});
  expect(body.nextCursor).toBe(cursor);
}

async function postGroup(
  actor: TestUser,
  organizationId: string,
  body: unknown,
) {
  return routeApp.request(`/organizations/${organizationId}/groups`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${actor.token}`,
    },
    body: JSON.stringify(body),
  });
}

test("deleted group IDs reject policy replay and catalog reuse", async () => {
  const owner = createTestUser();
  const organization = await registerActor(owner);
  const groupId = crypto.randomUUID();
  const request = await createGroupRequest({
    actor: owner,
    groupId,
    name: "Ephemeral",
  });
  expect(
    (await postGroup(owner, organization.organizationId, request)).status,
  ).toBe(200);
  const createdState = await getCurrentPrincipalState("group", groupId, db);
  invariant(createdState, "expected created group state");
  const staleDirectoryRemoval = await routeApp.request(
    `/organizations/${organization.organizationId}/groups/${groupId}`,
    {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${owner.token}`,
      },
      body: JSON.stringify({
        organizationPolicy: request.organizationPolicy,
      }),
    },
  );
  expect(staleDirectoryRemoval.status).toBe(409);
  expect(await getCurrentPrincipalState("group", groupId, db)).toEqual(
    createdState,
  );
  await db.insert(principalContainerGrantProjection).values({
    accessLevel: "read",
    containerId: crypto.randomUUID(),
    principalId: groupId,
    principalType: "group",
    stateHash: createdState.stateHash,
  });
  const deleteResponse = await deleteGroupRequest({
    actor: owner,
    groupId,
    organizationId: organization.organizationId,
  });
  expect(deleteResponse.status).toBe(200);
  expect(
    await db
      .select({ id: principalContainerGrantProjection.id })
      .from(principalContainerGrantProjection)
      .where(eq(principalContainerGrantProjection.principalId, groupId)),
  ).toEqual([]);
  const before = await readSnapshot(owner, organization.organizationId);

  const replayResponse = await routeApp.request(
    `/principals/group/${groupId}/policy`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${owner.token}`,
      },
      body: JSON.stringify(request.initialGroupPolicy),
    },
  );
  expect(replayResponse.status).toBe(409);
  expect(await getCurrentPrincipalState("group", groupId, db)).toBeNull();

  const reuseResponse = await postGroup(
    owner,
    organization.organizationId,
    request,
  );
  expect(reuseResponse.status).toBe(409);
  await expectNoChange(owner, organization.organizationId, before.nextCursor);
});

test("group creation rejects an initial policy naming a disabled user", async () => {
  // Creating a group takes its own route, not the policy PUT, so it needs the
  // same roster rule: standing a group up around a disabled user would hand
  // back through a later grant exactly the access disabling revoked.
  const owner = createTestUser();
  const organization = await registerActor(owner);
  const disabledUser = createTestUser();
  await registerUser(disabledUser);
  await db.insert(organizationRosterEntries).values({
    organizationId: organization.organizationId,
    userId: disabledUser.userId,
    status: "disabled",
    disabledAt: new Date("2026-05-24T12:00:00.000Z"),
    disabledByUserId: owner.userId,
  });

  const groupId = crypto.randomUUID();
  const request = await createGroupRequest({
    actor: owner,
    additionalMembers: [disabledUser],
    groupId,
    name: "Revoked",
  });

  const response = await postGroup(owner, organization.organizationId, request);
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    error: "Principal contains disabled organization users",
  });
  expect(await getCurrentPrincipalState("group", groupId, db)).toBeNull();
});

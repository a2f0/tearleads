import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { groups as groupsTable } from "@tearleads/api-shared/schema";
import { createTestUser, type TestUser } from "@tearleads/test-utils";
import { isOrganizationGroupMembersResponse } from "@tearleads/validators/response";
import { getDefaultOrganizationId } from "../../../test/helpers/organizationMembership";
import {
  loadOrganizationGroups,
  registerAndAuthenticateUsers,
} from "../../../test/helpers/principalPolicyReadFixtures";
import { routeApp } from "../../routeApp";

function getMembers(actor: TestUser, organizationId: string, groupId: string) {
  return routeApp.request(
    `/organizations/${organizationId}/groups/${groupId}/members`,
    { headers: { Authorization: `Bearer ${actor.token}` } },
  );
}

test("group members name each member of the current head, with only id and role", async () => {
  const owner = createTestUser();
  await registerAndAuthenticateUsers(owner);
  const organizationId = await getDefaultOrganizationId(owner.userId);
  const { adminGroupId } = await loadOrganizationGroups(organizationId);

  const response = await getMembers(owner, organizationId, adminGroupId);
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(isOrganizationGroupMembersResponse(body)).toBe(true);
  expect(body).toEqual({
    groupId: adminGroupId,
    members: [{ role: "admin", userId: owner.userId }],
    organizationId,
  });
});

test("group members refuse another organization's group, then a group without a policy", async () => {
  const owner = createTestUser();
  const other = createTestUser();
  await registerAndAuthenticateUsers(owner, other);
  const organizationId = await getDefaultOrganizationId(owner.userId);
  const otherOrganizationId = await getDefaultOrganizationId(other.userId);
  const { adminGroupId: otherAdminGroupId } =
    await loadOrganizationGroups(otherOrganizationId);

  const foreign = await getMembers(owner, organizationId, otherAdminGroupId);
  expect(foreign.status).toBe(404);
  expect(await foreign.json()).toMatchObject({ error: "Group not found" });

  const [stateless] = await db
    .insert(groupsTable)
    .values({ organizationId })
    .returning({ id: groupsTable.id });
  if (!stateless) throw new Error("expected a group row");
  const missingPolicy = await getMembers(owner, organizationId, stateless.id);
  expect(missingPolicy.status).toBe(404);
  expect(await missingPolicy.json()).toMatchObject({
    error: "Group policy not found",
  });
});

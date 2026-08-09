import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  organizations,
  principalMembershipProjection,
  users,
} from "@tearleads/api-shared/schema";
import { createTestUser, type TestUser } from "@tearleads/bob-and-alice";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import { registerUser } from "../../../test/helpers/registerUser";
import { getCurrentPrincipalState } from "../../access/read/principalStateStore";
import { routeApp } from "../../routeApp";

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

function authHeader(user: TestUser): { Authorization: string } {
  return { Authorization: `Bearer ${user.token}` };
}

test("organization access rejects database-injected membership", async () => {
  const owner = createTestUser();
  const organizationId = await registerAndAuthenticate(owner);
  const outsider = createTestUser();
  await registerAndAuthenticate(outsider);
  const [organization] = await db
    .select({ memberGroupId: organizations.memberGroupId })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  invariant(organization, "expected organization row");
  const memberState = await getCurrentPrincipalState(
    "group",
    organization.memberGroupId,
    db,
  );
  invariant(memberState, "expected Members policy state");

  await db.insert(principalMembershipProjection).values({
    principalType: "group",
    principalId: organization.memberGroupId,
    stateHash: memberState.stateHash,
    userId: outsider.userId,
    role: "member",
  });

  const response = await routeApp.request(
    `/organizations/${organizationId}/read-model`,
    { headers: authHeader(outsider) },
  );

  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    error: "Organization access policy failed integrity verification",
  });
});

test("organization access rejects a repointed reserved Admins group", async () => {
  const owner = createTestUser();
  const organizationId = await registerAndAuthenticate(owner);
  const outsider = createTestUser();
  const outsiderOrganizationId = await registerAndAuthenticate(outsider);
  const [outsiderOrganization] = await db
    .select({ adminGroupId: organizations.adminGroupId })
    .from(organizations)
    .where(eq(organizations.id, outsiderOrganizationId));
  invariant(outsiderOrganization, "expected outsider organization");

  await db
    .update(organizations)
    .set({ adminGroupId: outsiderOrganization.adminGroupId })
    .where(eq(organizations.id, organizationId));

  const response = await routeApp.request(
    `/organizations/${organizationId}/read-model`,
    { headers: authHeader(outsider) },
  );

  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    error: "Organization access policy failed integrity verification",
  });
});

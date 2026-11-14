import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  organizations,
  principalMembershipProjection,
  principalStates,
} from "@tearleads/api-shared/schema";
import { createTestUser, type TestUser } from "@tearleads/test-utils";
import { PendingBlobDeletionsResponseSchema } from "@tearleads/validators/response";
import { and, eq } from "drizzle-orm";
import { addUserToAdminGroup } from "../../../test/helpers/organizationAdmin";
import { addMemberGroupUser } from "../../../test/helpers/organizationMember";
import { seedPendingBlobDeletion } from "../../../test/helpers/pendingBlobDeletion";
import { registeredProjection } from "../../../test/helpers/policyProjection";
import { registerAndAuthenticateWithOrganization } from "../../../test/helpers/registerUser";
import { getCurrentPrincipalState } from "../../access/read/principalStateStore";
import { routeApp } from "../../routeApp";

const headers = (user: TestUser) => ({ Authorization: `Bearer ${user.token}` });
const path = (organizationId: string) =>
  `/organizations/${organizationId}/blobs/pending-deletion`;

test("only the current organization admin reads the queue, and query filters cannot escape ownership", async () => {
  const owner = createTestUser();
  const organizationId = await registerAndAuthenticateWithOrganization(owner);
  const member = createTestUser();
  const otherOrganizationId =
    await registerAndAuthenticateWithOrganization(member);
  await addMemberGroupUser({
    actor: owner,
    memberUserId: member.userId,
    organizationId,
  });
  const outsider = createTestUser();
  await registerAndAuthenticateWithOrganization(outsider);
  const ownBlob = await seedPendingBlobDeletion(db, organizationId);
  await seedPendingBlobDeletion(db, organizationId);
  const foreign = await seedPendingBlobDeletion(db, otherOrganizationId);
  expect((await routeApp.request(path(organizationId))).status).toBe(401);
  for (const denied of [member, outsider]) {
    const response = await routeApp.request(path(organizationId), {
      headers: headers(denied),
    });
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain(ownBlob.blobId);
  }
  const response = await routeApp.request(
    `${path(organizationId)}?organizationId=${otherOrganizationId}&limit=1`,
    { headers: headers(owner) },
  );
  expect(response.status).toBe(200);
  const first = PendingBlobDeletionsResponseSchema.parse(await response.json());
  expect(first.blobs).toHaveLength(1);
  expect(first.blobs[0]?.organizationId).toBe(organizationId);
  expect(first.blobs[0]?.blobId).not.toBe(foreign.blobId);
  if (!first.nextAfterId) throw new Error("Expected continuation");
  const nextQuery = `?cursor=${encodeURIComponent(first.nextAfterId)}&limit=1`;
  const next = await routeApp.request(`${path(organizationId)}${nextQuery}`, {
    headers: headers(owner),
  });
  const last = PendingBlobDeletionsResponseSchema.parse(await next.json());
  expect(last.blobs).toHaveLength(1);
  expect(last.blobs[0]?.blobId).not.toBe(first.blobs[0]?.blobId);
  expect(last.nextAfterId).toBeNull();
  expect(
    (
      await routeApp.request(`${path(otherOrganizationId)}${nextQuery}`, {
        headers: headers(member),
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await routeApp.request(`${path(organizationId)}${nextQuery}`, {
        headers: headers(member),
      })
    ).status,
  ).toBe(403);
  for (const query of [
    "limit=0",
    "limit=101",
    "limit=1.5",
    "cursor=bad-cursor",
  ]) {
    expect(
      (
        await routeApp.request(`${path(organizationId)}?${query}`, {
          headers: headers(owner),
        })
      ).status,
    ).toBe(400);
  }
});

test("database-injected admin membership cannot authorize pending deletion reads", async () => {
  const owner = createTestUser();
  const organizationId = await registerAndAuthenticateWithOrganization(owner);
  const outsider = createTestUser();
  await registerAndAuthenticateWithOrganization(outsider);
  const [organization] = await db
    .select({ adminGroupId: organizations.adminGroupId })
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  if (!organization) throw new Error("Missing organization");
  const state = await getCurrentPrincipalState(
    "group",
    organization.adminGroupId,
    db,
  );
  if (!state) throw new Error("Missing Admins state");
  const [projection] = await registeredProjection([
    { userId: outsider.userId, role: "admin" },
  ]);
  if (!projection) throw new Error("Missing outsider projection");
  await db.insert(principalMembershipProjection).values({
    principalType: "group",
    principalId: organization.adminGroupId,
    stateHash: state.stateHash,
    ...projection,
  });
  const response = await routeApp.request(path(organizationId), {
    headers: headers(outsider),
  });
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    error: "Organization access policy failed integrity verification",
  });
});

test("each page verifies current signed directory heads rather than trusting a prior admin decision", async () => {
  const owner = createTestUser();
  const organizationId = await registerAndAuthenticateWithOrganization(owner);
  const admin = createTestUser();
  await registerAndAuthenticateWithOrganization(admin);
  const adminGroupId = await addUserToAdminGroup({
    actor: owner,
    member: admin,
    organizationId,
  });
  await seedPendingBlobDeletion(db, organizationId);
  await seedPendingBlobDeletion(db, organizationId);
  const first = await routeApp.request(`${path(organizationId)}?limit=1`, {
    headers: headers(admin),
  });
  expect(first.status).toBe(200);
  const page = PendingBlobDeletionsResponseSchema.parse(await first.json());
  if (!page.nextAfterId) throw new Error("Expected continuation");
  const state = await getCurrentPrincipalState("group", adminGroupId, db);
  if (!state || state.version <= 1)
    throw new Error("Expected advanced admin policy");
  await db
    .delete(principalStates)
    .where(
      and(
        eq(principalStates.principalType, "group"),
        eq(principalStates.principalId, adminGroupId),
        eq(principalStates.version, state.version),
      ),
    );
  const next = await routeApp.request(
    `${path(organizationId)}?cursor=${encodeURIComponent(page.nextAfterId)}`,
    { headers: headers(admin) },
  );
  expect(next.status).toBe(409);
});

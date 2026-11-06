import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  organizationRosterEntries,
  organizations,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/test-utils";
import {
  isOrganizationDataUsageResponse,
  isOrganizationDirectoryUserResponse,
  isOrganizationProfileResponse,
} from "@tearleads/validators/response";
import { and, eq } from "drizzle-orm";
import invariant from "invariant";
import { createCurrentDocumentProjection } from "../../../test/helpers/currentProtocolProjection";
import { seedOrganizationDataUsage } from "../../../test/helpers/organizationDataUsage";
import { loadOrganizationMetadataContainerId } from "../../../test/helpers/organizationMetadataContainer";
import { loadOrganizationReadModelSnapshot } from "../../../test/helpers/organizationReadModel";
import { registerAndAuthenticateWithOrganization } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";
import { upsertActiveOrganizationRosterEntries } from "../../workflows/organizations/roster";

test("organization read model includes the current org directory", async () => {
  const actor = createTestUser();
  const organizationId = await registerAndAuthenticateWithOrganization(actor);
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
  const organizationId = await registerAndAuthenticateWithOrganization(actor);

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
  const organizationId = await registerAndAuthenticateWithOrganization(actor);
  const disabledUser = createTestUser();
  await registerAndAuthenticateWithOrganization(disabledUser);
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
  const organizationId = await registerAndAuthenticateWithOrganization(actor);

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
  const organizationId = await registerAndAuthenticateWithOrganization(actor);
  const { id: profileDocumentId } = await createCurrentDocumentProjection({
    containerIds: [await loadOrganizationMetadataContainerId(organizationId)],
    createdByFingerprint: actor.fingerprint,
    organizationId,
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

test("organization read model includes the bootstrap Admins group", async () => {
  const actor = createTestUser();
  const organizationId = await registerAndAuthenticateWithOrganization(actor);
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
  expect(listBody.groups.every((group) => !("name" in group))).toBe(true);
  expect(listBody.groups[0]?.isBuiltin).toBe(true);
  expect(listBody.groups[0]?.currentState?.memberCount).toBe(1);
});

test("org manager routes report organization data usage", async () => {
  const actor = createTestUser();
  const organizationId = await registerAndAuthenticateWithOrganization(actor);
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

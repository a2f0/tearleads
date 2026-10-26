import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { organizationRosterEntries } from "@tearleads/api-shared/schema";
import { createTestUser, type TestUser } from "@tearleads/test-utils";
import {
  isOrganizationMembershipResponse,
  isOrganizationMembershipsResponse,
} from "@tearleads/validators/response";
import { authenticate } from "../../../test/helpers/authenticate";
import { getDefaultOrganizationId } from "../../../test/helpers/organizationMembership";
import { registerUser } from "../../../test/helpers/registerUser";
import type { PublishedRealtimeEvent } from "../../realtime/publishedRealtimeEvents";
import { createRouteApp } from "../../routeApp";

function createApp(published: PublishedRealtimeEvent[]) {
  return createRouteApp({
    publish: async (event) => {
      published.push(event);
    },
  });
}

async function registeredUser(): Promise<TestUser> {
  const user = createTestUser();
  await registerUser(user);
  await authenticate(user);
  return user;
}

async function listMemberships(
  app: ReturnType<typeof createApp>,
  user: TestUser,
) {
  const response = await app.request("/organization-memberships", {
    headers: { Authorization: `Bearer ${user.token}` },
  });
  expect(response.status).toBe(200);
  const body: unknown = await response.json();
  if (!isOrganizationMembershipsResponse(body)) {
    throw new Error("Expected an organization memberships response");
  }
  return body.memberships;
}

async function putMembership(
  app: ReturnType<typeof createApp>,
  user: TestUser,
  organizationId: string,
  syncPaused: boolean,
): Promise<Response> {
  return app.request(`/organization-memberships/${organizationId}`, {
    body: JSON.stringify({ syncPaused }),
    headers: {
      Authorization: `Bearer ${user.token}`,
      "Content-Type": "application/json",
    },
    method: "PUT",
  });
}

// Roster rows are product state written by Members commits; inserting one
// stands in for an enrollment the membership endpoints only read.
async function enrollInOrganization(
  user: TestUser,
  status: "active" | "disabled" = "active",
): Promise<string> {
  const organizationId = crypto.randomUUID();
  await db.insert(organizationRosterEntries).values({
    organizationId,
    status,
    userId: user.userId,
  });
  return organizationId;
}

test("lists the session user's active memberships, marking the personal organization", async () => {
  const app = createApp([]);
  const user = await registeredUser();
  const personalOrganizationId = await getDefaultOrganizationId(user.userId);
  const memberOrganizationId = await enrollInOrganization(user);
  await enrollInOrganization(user, "disabled");
  await enrollInOrganization(await registeredUser());

  const memberships = await listMemberships(app, user);

  expect(
    [...memberships].sort((left, right) =>
      left.organizationId.localeCompare(right.organizationId),
    ),
  ).toEqual(
    [
      {
        isPersonalOrganizationOwner: true,
        leaveRequestedAt: null,
        organizationId: personalOrganizationId,
        syncPaused: false,
      },
      {
        isPersonalOrganizationOwner: false,
        leaveRequestedAt: null,
        organizationId: memberOrganizationId,
        syncPaused: false,
      },
    ].sort((left, right) =>
      left.organizationId.localeCompare(right.organizationId),
    ),
  );
});

test("pausing and resuming sync is the member's own choice and wakes their clients", async () => {
  const published: PublishedRealtimeEvent[] = [];
  const app = createApp(published);
  const user = await registeredUser();
  const organizationId = await enrollInOrganization(user);

  const paused = await putMembership(app, user, organizationId, true);
  expect(paused.status).toBe(200);
  const pausedBody: unknown = await paused.json();
  expect(
    isOrganizationMembershipResponse(pausedBody) && pausedBody.syncPaused,
  ).toBe(true);
  expect(
    (await listMemberships(app, user)).find(
      (membership) => membership.organizationId === organizationId,
    )?.syncPaused,
  ).toBe(true);
  expect(published).toEqual([
    { type: "organization_memberships_changed", userId: user.userId },
  ]);

  const resumed = await putMembership(app, user, organizationId, false);
  expect(resumed.status).toBe(200);
  expect(
    (await listMemberships(app, user)).find(
      (membership) => membership.organizationId === organizationId,
    )?.syncPaused,
  ).toBe(false);
});

test("a personal organization cannot be paused", async () => {
  const published: PublishedRealtimeEvent[] = [];
  const app = createApp(published);
  const user = await registeredUser();
  const personalOrganizationId = await getDefaultOrganizationId(user.userId);

  const response = await putMembership(app, user, personalOrganizationId, true);

  expect(response.status).toBe(409);
  expect(published).toEqual([]);
  expect(
    (await putMembership(app, user, personalOrganizationId, false)).status,
  ).toBe(200);
});

test("only an active member can change their own membership", async () => {
  const app = createApp([]);
  const user = await registeredUser();
  const disabledOrganizationId = await enrollInOrganization(user, "disabled");
  const otherMemberOrganizationId = await enrollInOrganization(
    await registeredUser(),
  );

  expect(
    (await putMembership(app, user, disabledOrganizationId, true)).status,
  ).toBe(404);
  expect(
    (await putMembership(app, user, otherMemberOrganizationId, true)).status,
  ).toBe(404);
  expect(
    (await putMembership(app, user, crypto.randomUUID(), true)).status,
  ).toBe(404);
});

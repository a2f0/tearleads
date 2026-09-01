import { expect, test } from "bun:test";
import {
  createOrganizationGroupOperation,
  deleteOrganizationGroupOperation,
  listOrganizationGroupMembersOperation,
  operationRoutePath,
  updateOrganizationProfileOperation,
  updateOrganizationRosterEntryOperation,
} from "@tearleads/validators/operation";
import type { MiddlewareHandler } from "hono";
import type { SessionEnv } from "../../middleware/session";
import type { ApiServiceRuntime } from "../../services/runtime";
import { createOrganizationGroupsRoute } from "./groups";
import { createOrganizationMutationsRoute } from "./mutations";
import { createOrganizationProfileRoute } from "./profile";
import { createOrganizationRosterRoute } from "./roster";

const groupId = "22222222-2222-4222-8222-222222222222";
const organizationId = "11111111-1111-4111-8111-111111111111";
const userId = "33333333-3333-4333-8333-333333333333";

function createRoutes(requireAuth: MiddlewareHandler<SessionEnv>) {
  const deps = { requireAuth, runtime: {} as ApiServiceRuntime };
  return {
    groups: createOrganizationGroupsRoute(deps),
    mutations: createOrganizationMutationsRoute(deps),
    profile: createOrganizationProfileRoute(deps),
    roster: createOrganizationRosterRoute(deps),
  };
}

test("organization management routes register from shared operations", () => {
  const routes = createRoutes((_c, next) => next());
  const registrations = [
    ...routes.groups.routes,
    ...routes.mutations.routes,
    ...routes.profile.routes,
    ...routes.roster.routes,
  ];
  for (const operation of [
    createOrganizationGroupOperation,
    deleteOrganizationGroupOperation,
    listOrganizationGroupMembersOperation,
    updateOrganizationProfileOperation,
    updateOrganizationRosterEntryOperation,
  ]) {
    expect(
      registrations.some(
        ({ method, path }) =>
          method === operation.method && path === operationRoutePath(operation),
      ),
    ).toBe(true);
  }
});

test("organization management authenticates before boundary validation", async () => {
  const routes = createRoutes(async (c) =>
    c.json({ error: "Unauthorized" }, 401),
  );
  const response = await routes.mutations.request(
    "/organizations/invalid/groups",
    {
      body: "{}",
      headers: { "Content-Type": "application/json" },
      method: createOrganizationGroupOperation.method,
    },
  );

  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ error: "Unauthorized" });
});

test("organization management rejects invalid bodies at the HTTP boundary", async () => {
  const routes = createRoutes((_c, next) => next());
  const requests = [
    routes.mutations.request(`/organizations/${organizationId}/groups`, {
      body: "{}",
      headers: { "Content-Type": "application/json" },
      method: createOrganizationGroupOperation.method,
    }),
    routes.profile.request(`/organizations/${organizationId}/profile`, {
      body: "{}",
      headers: { "Content-Type": "application/json" },
      method: updateOrganizationProfileOperation.method,
    }),
    routes.roster.request(`/organizations/${organizationId}/roster/${userId}`, {
      body: "{}",
      headers: { "Content-Type": "application/json" },
      method: updateOrganizationRosterEntryOperation.method,
    }),
  ];

  for (const request of requests) {
    const response = await request;
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid request" });
  }
});

test("organization management rejects invalid path parameters at the HTTP boundary", async () => {
  const routes = createRoutes((_c, next) => next());
  const deleteResponse = await routes.mutations.request(
    `/organizations/${organizationId}/groups/invalid`,
    { method: deleteOrganizationGroupOperation.method },
  );
  const membersResponse = await routes.groups.request(
    `/organizations/invalid/groups/${groupId}/members`,
    { method: listOrganizationGroupMembersOperation.method },
  );
  const profileResponse = await routes.profile.request(
    "/organizations/invalid/profile",
    {
      body: JSON.stringify({ profileDocumentId: null }),
      headers: { "Content-Type": "application/json" },
      method: updateOrganizationProfileOperation.method,
    },
  );
  const rosterResponse = await routes.roster.request(
    `/organizations/${organizationId}/roster/invalid`,
    {
      body: JSON.stringify({ profileDocumentId: null }),
      headers: { "Content-Type": "application/json" },
      method: updateOrganizationRosterEntryOperation.method,
    },
  );

  expect(await deleteResponse.json()).toEqual({
    error: "Invalid organization group route",
  });
  expect(await membersResponse.json()).toEqual({
    error: "Invalid organization group route",
  });
  expect(await profileResponse.json()).toEqual({
    error: "Invalid organizationId",
  });
  expect(await rosterResponse.json()).toEqual({
    error: "Invalid roster route",
  });
  for (const response of [
    deleteResponse,
    membersResponse,
    profileResponse,
    rosterResponse,
  ]) {
    expect(response.status).toBe(400);
  }
});

test("organization management preserves malformed JSON behavior", async () => {
  const routes = createRoutes((_c, next) => next());
  const response = await routes.profile.request(
    `/organizations/${organizationId}/profile`,
    {
      body: "{",
      headers: { "Content-Type": "application/json" },
      method: updateOrganizationProfileOperation.method,
    },
  );

  expect(response.status).toBe(400);
  expect(await response.text()).toBe("Malformed JSON in request body");
});

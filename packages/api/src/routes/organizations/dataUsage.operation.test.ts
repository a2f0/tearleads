import { expect, test } from "bun:test";
import {
  getOrganizationDataUsageOperation,
  operationRoutePath,
} from "@tearleads/validators/operation";
import type { MiddlewareHandler } from "hono";
import type { SessionEnv } from "../../middleware/session";
import type { ApiServiceRuntime } from "../../services/runtime";
import { createOrganizationDataUsageRoute } from "./dataUsage";

function createTestRoute(requireAuth: MiddlewareHandler<SessionEnv>) {
  return createOrganizationDataUsageRoute({
    requireAuth,
    runtime: {} as ApiServiceRuntime,
  });
}

test("organization data usage route is registered from the shared operation", () => {
  const route = createTestRoute((_c, next) => next());

  expect(
    route.routes.some(
      ({ method, path }) =>
        method === getOrganizationDataUsageOperation.method &&
        path === operationRoutePath(getOrganizationDataUsageOperation),
    ),
  ).toBe(true);
});

test("organization data usage authenticates before validating path parameters", async () => {
  const route = createTestRoute(async (c) =>
    c.json({ error: "Unauthorized" }, 401),
  );
  const response = await route.request("/organizations/invalid/data-usage", {
    method: getOrganizationDataUsageOperation.method,
  });

  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ error: "Unauthorized" });
});

test("organization data usage rejects invalid path parameters at the HTTP boundary", async () => {
  const route = createTestRoute((_c, next) => next());
  const response = await route.request("/organizations/invalid/data-usage", {
    method: getOrganizationDataUsageOperation.method,
  });

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "Invalid organizationId" });
});

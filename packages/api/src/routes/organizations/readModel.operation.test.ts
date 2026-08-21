import { expect, test } from "bun:test";
import {
  getOrganizationReadModelOperation,
  operationRoutePath,
} from "@symcrypt/validators/operation";
import type { MiddlewareHandler } from "hono";
import type { SessionEnv } from "../../middleware/session";
import type { ApiServiceRuntime } from "../../services/runtime";
import { createOrganizationReadModelRoute } from "./readModel";

function createRoute(requireAuth: MiddlewareHandler<SessionEnv>) {
  return createOrganizationReadModelRoute({
    requireAuth,
    runtime: {} as ApiServiceRuntime,
  });
}

test("organization read-model route registers from its shared operation", () => {
  const route = createRoute((_c, next) => next());

  expect(route.routes).toContainEqual(
    expect.objectContaining({
      method: getOrganizationReadModelOperation.method,
      path: operationRoutePath(getOrganizationReadModelOperation),
    }),
  );
});

test("organization read-model authenticates before boundary validation", async () => {
  const route = createRoute(async (c) =>
    c.json({ error: "Unauthorized" }, 401),
  );
  const response = await route.request(
    "/organizations/invalid/read-model?cursor=malformed",
  );

  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ error: "Unauthorized" });
});

test("organization read-model rejects invalid path parameters at the boundary", async () => {
  const route = createRoute((_c, next) => next());
  const response = await route.request("/organizations/invalid/read-model");

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "Invalid organizationId" });
});

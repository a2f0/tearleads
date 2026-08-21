import { expect, test } from "bun:test";
import {
  createOrganizationOperation,
  operationRoutePath,
} from "@symcrypt/validators/operation";
import type { MiddlewareHandler } from "hono";
import type { SessionEnv } from "../../middleware/session";
import type { ApiServiceRuntime } from "../../services/runtime";
import { createOrganizationCreateRoute } from "./create";

function createTestRoute(requireAuth: MiddlewareHandler<SessionEnv>) {
  return createOrganizationCreateRoute({
    requireAuth,
    runtime: {} as ApiServiceRuntime,
  });
}

test("create organization route is registered from the shared operation", () => {
  const route = createTestRoute((_c, next) => next());

  expect(
    route.routes.some(
      ({ method, path }) =>
        method === createOrganizationOperation.method &&
        path === operationRoutePath(createOrganizationOperation),
    ),
  ).toBe(true);
});

test("create organization authenticates before validating its request", async () => {
  const route = createTestRoute(async (c) =>
    c.json({ error: "Unauthorized" }, 401),
  );
  const response = await route.request("/organizations", {
    body: "{}",
    headers: { "Content-Type": "application/json" },
    method: createOrganizationOperation.method,
  });

  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ error: "Unauthorized" });
});

test("create organization rejects invalid input at the HTTP boundary", async () => {
  const route = createTestRoute((_c, next) => next());
  const response = await route.request("/organizations", {
    body: "{}",
    headers: { "Content-Type": "application/json" },
    method: createOrganizationOperation.method,
  });

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "Invalid request" });
});

test("create organization preserves the malformed JSON response", async () => {
  const route = createTestRoute((_c, next) => next());
  const response = await route.request("/organizations", {
    body: "{",
    headers: { "Content-Type": "application/json" },
    method: createOrganizationOperation.method,
  });

  expect(response.status).toBe(400);
  expect(await response.text()).toBe("Malformed JSON in request body");
});

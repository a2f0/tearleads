import { expect, test } from "bun:test";
import {
  getPrincipalPolicyOperation,
  operationRoutePath,
  putPrincipalPolicyOperation,
} from "@symcrypt/validators/operation";
import type { MiddlewareHandler } from "hono";
import type { SessionEnv } from "../../middleware/session";
import type { ApiServiceRuntime } from "../../services/runtime";
import { createPrincipalPolicyRoute } from "./policy";

const principalId = "11111111-1111-4111-8111-111111111111";

function createRoute(requireAuth: MiddlewareHandler<SessionEnv>) {
  return createPrincipalPolicyRoute({
    publish: async () => undefined,
    requireAuth,
    runtime: {} as ApiServiceRuntime,
  });
}

test("principal policy routes register from shared operations", () => {
  const route = createRoute((_c, next) => next());

  for (const operation of [
    getPrincipalPolicyOperation,
    putPrincipalPolicyOperation,
  ]) {
    expect(route.routes).toContainEqual(
      expect.objectContaining({
        method: operation.method,
        path: operationRoutePath(operation),
      }),
    );
  }
});

test("principal policy routes authenticate before boundary validation", async () => {
  const route = createRoute(async (c) =>
    c.json({ error: "Unauthorized" }, 401),
  );
  const response = await route.request("/principals/team/invalid/policy", {
    body: "{}",
    headers: { "Content-Type": "application/json" },
    method: putPrincipalPolicyOperation.method,
  });

  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ error: "Unauthorized" });
});

test("principal policy routes reject invalid path parameters at the boundary", async () => {
  const route = createRoute((_c, next) => next());
  const response = await route.request("/principals/team/invalid/policy", {
    method: getPrincipalPolicyOperation.method,
  });

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "Invalid principal route" });
});

test("principal policy PUT preserves body-before-path validation", async () => {
  const route = createRoute((_c, next) => next());
  const response = await route.request("/principals/team/invalid/policy", {
    body: "{}",
    headers: { "Content-Type": "application/json" },
    method: putPrincipalPolicyOperation.method,
  });

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "Invalid request" });
});

test("principal policy PUT rejects invalid bodies at the boundary", async () => {
  const route = createRoute((_c, next) => next());
  const response = await route.request(
    `/principals/group/${principalId}/policy`,
    {
      body: "{}",
      headers: { "Content-Type": "application/json" },
      method: putPrincipalPolicyOperation.method,
    },
  );

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "Invalid request" });
});
